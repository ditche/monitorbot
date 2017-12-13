var minimist = require('minimist')
  , n = require('numbro')
  , colors = require('colors')
  
var fs = require('fs');
var util = require('util');
 
module.exports = function container (get, set, clear) {
  var c = get('conf')
  return function (program) {
    program
      .command('monitor [selector]')
      .allowUnknownOption()
      .description('Monitor the total value of the holdings')
      .option('--poll_time <number>', 'update interval in seconds', Number, c.poll_time)
      .option('--keep_log', 'keep log file (true/false)')
      .option('--rebalance', 'rebalance according to specified % ')
      .option('--auto', 'execute the rebalancing automatically ')
      .option('--trigger_pct <pct>', 'trigger rebalance when differs by pct', Boolean, c.trigger)
      .option('--above <val>', 'only increase cash when total value is above this amount', Number, c.above)
      .action(function (selector, cmd) {
        
        var argv = require('minimist')(process.argv.slice(2));
        if (typeof argv.poll_time == 'undefined') argv.poll_time = 360
        if (typeof argv.trigger == 'undefined') argv.trigger = 0.03
        if (typeof argv.above == 'undefined') argv.above = 0
        if (typeof argv.trigger_pct == 'undefined') {
          argv.trigger_pct = 0.05
        } else {
          argv.trigger_pct = n(argv.trigger_pct)/100
        }
        console.log("Polling every (seconds): " + argv.poll_time);
        
        if (argv.keep_log) {
          var log_file = fs.createWriteStream('./gdax.log', {flags : 'a'});
        }
        var log_stdout = process.stdout;

        function myLog(d) { //
          if (argv.keep_log) log_file.write(util.format(d) + '\n');
          log_stdout.write(util.format(d) + '\n');
        };
        
        var s = {options: minimist(process.argv)}
        var so = s.options
        delete so._

        Object.keys(c).forEach(function (k) {
          if (typeof cmd[k] !== 'undefined') {
            so[k] = cmd[k]
            
          }
        })
        
        function vectorSum(v) {
          var s=0
          for (var i=0; i<v.length; i++) {
            s+=v[i]
          }
          return s
        }
        
        function saveSettings(cb) {
          var monitor_settings = {
            target_prop: target_prop,
            cash_target: cash_target
          }
          fs.writeFile( "./monitor.json", JSON.stringify( monitor_settings ), encoding="utf8", flags="w", callback=cb );

        }
        
        // ===== Trading pairs settings =======
        s.exchange = get('exchanges.gdax')
        selectors = ['gdax.BTC-USD', 'gdax.ETH-USD', 'gdax.LTC-USD']
        s.currency = 'USD'
        // how much of each asset is in cold storage?
        var reserved_assets = [0,0,0]
        var reserved_cash = 6000 - 1468
        var leverage = 1.5
        
        // initialize the exchanges
        var ss = []
        for (var i=0; i<selectors.length; i++) {
          var new_s = JSON.parse(JSON.stringify(s))
          new_s.options.selector = selectors[i]
          new_s.options.mode = "live"
          new_s.engine = get('lib.engine')(new_s)
          var selector_parts = selectors[i].split('.')
          new_s.product_id = selector_parts[1]
          new_s.asset_change = 0
          new_s.currency_change = 0
          new_s.reserved = reserved_assets[i]
          ss.push(new_s)
        }
        
        // ==== Allocation settings ====
        // global variables
        var target_prop = [.100, .6000, .2000]
        // old
        // var target_prop = [.1100, .6000, .2000]
        var cash_target = 0.15
        
        // read the target values from file
        try {
          monitor_settings = require("../monitor.json");
          target_prop = monitor_settings.target_prop
          setTargets(monitor_settings.cash_target)
        } catch (ex) {
          // initial target (if not saved in a file)
          setTargets(0.22)
        }
        
        // Triggers, balance allocation based on price
        // loads the cashTriggers function
        require("../monitor_cfg.js");
        
        
        // calculate the targets, adjusting for the given cash_target
        // reset=true will adjust the 
        function setTargets(ctarget) {
          if (ctarget != cash_target) cash_target = ctarget
          
          var targets = target_prop.slice();
          
          for (var i=0; i<selectors.length; i++) {         
            targets[i] = target_prop[i] * (1-cash_target) / vectorSum(target_prop)
          }
          
          for (var i=0; i<selectors.length; i++) {
            ss[i].target_pct = targets[i]
          }
          console.log("Targets percentages for", selectors, ":")
          var targets_rounded = targets.map(function(j) {return Math.round(j*1000)/1000})
          console.log(targets_rounded, cash_target)
        }
        
        function setProp(atarget) {
          var changed = false
          for (var i=0; i<atarget.length; i++) {
            if (target_prop[i] != atarget[i]) changed = true
          }
          if (changed) {
            target_prop = atarget
            setTargets(cash_target)
          }
        }
        
        
        // ========================================
        // gets the quote and balance of a product                
        function getTotalBalance (s, cb) {
          s.exchange.getBalance(s, function (err, balance) {
            if (err) {
              if (err.body) 
                console.log(err.body) 
              else 
                console.log(err)
              return cb(null, err)
            }
            
            balance.asset = n(balance.asset) + s.reserved
            
            var summary = {product: s.product_id, asset: balance.asset, currency: balance.currency}

            s.exchange.getQuote({product_id: s.product_id}, function (err, quote) {
              if (err) {
                s.summary = null
                return cb(null, err)
              }
              s.quote = quote
              asset_value = n(balance.asset).multiply(quote.ask)
              summary.currency_value = n(balance.currency) + reserved_cash
              //myLog(s.product_id + ": " + n(balance.asset).format('0.00') + " " + quote.ask + " Total: " + asset_value.format('0.00'))
              summary.ask = quote.ask
              summary.bid = quote.bid
              summary.mid = 0.5 * n(quote.ask).add(quote.bid)
              if (!s.traded_price) s.traded_price = summary.mid
              summary.traded_price = s.traded_price
              summary.asset_value = asset_value
              summary.target_pct = s.target_pct
              s.summary = summary
              cb(summary)
            })
          })
          
        }
        
        // rebalance all products (and cash) to match the target allocation
        function rebalance(rebalance_now) {
          var account_value = ss[0].summary.currency_value
          
          for (var i=0; i<ss.length; i++) {
            summary = ss[i].summary
            account_value += summary.asset_value
          }
          
          var target_val, target_price, size, trigger_pct, mid_price, offer_price
          var order_list = []
          
          // immediately rebalance without waiting for the trigger
          if (rebalance_now) {
            trigger_pct = 0.001
          } else {
            trigger_pct = argv.trigger_pct
          }
          
          for (var i=0; i<ss.length; i++) {
            summary = ss[i].summary
            target_value = n(summary.target_pct) * n(account_value)
            mid_price = summary.mid
            
            if (target_value > summary.asset_value * (1+trigger_pct)) {
              
              if (rebalance_now == "buy" || rebalance_now == "all" || rebalance_now == false || rebalance_now == "check") {
                size = (target_value-summary.asset_value) / summary.ask
              } else {
                size = 0
              }
              if (size > 0.01) {
                // maker or taker
                if (maker_order) {
                  offer_price = Math.floor(mid_price * 100) / 100
                } else {
                  offer_price = summary.ask
                }
                console.log("Buy ", summary.product ,"with", n(target_value-summary.asset_value).format('0.00'), "size:", n(size).format('0.000'), "for", Math.round(summary.target_pct*1000)/1000, "at", offer_price)
                
                opt = {product_id: summary.product, size: size, price: offer_price, side: "buy"}
                order_list.push(opt)
              }
            } else if (buy_only==false && target_value < summary.asset_value * (1-trigger_pct)) {
              if (rebalance_now == "sell" || rebalance_now == "all" || rebalance_now == false  || rebalance_now == "check") {
                size = (summary.asset_value-target_value) / summary.bid
              } else {
                size = 0
              }
              if (size > 0.01) {
                // maker or taker
                if (maker_order) {
                  offer_price = Math.ceil(mid_price * 100) / 100
                } else {
                  offer_price = summary.bid
                }   
                console.log("Sell ", summary.product ,"with", n(summary.asset_value - target_value).format('0.00'), "size:", n(size).format('0.000'), "for", Math.round(summary.target_pct*1000)/1000, "at", offer_price)
                                                                               
                opt = {product_id: summary.product, size: size, price: offer_price, side: "sell"}
                order_list.unshift(opt)
              }
            }
          }
          // execute the orders
          for (var i=0; i<order_list.length; i++) {
            if (rebalance_now != "check") {
              if (argv.auto || manual_order) placeOrder(order_list[i])
            }
          }
        }
        
        function cancelOrder(s0, cb) {
          if (s0.api_order) {
            if (s0.api_order.status == 'open') {
              s0.exchange.cancelOrder({order_id: s0.api_order.id}, function (err) {
                if (err) {
                  console.error('\ncould not cancel order for', s0.product_id)
                  console.error(err)
                  return cb(err)
                }
                delete s0.api_order
                // wait a bit for settlement
                setTimeout(function () {
                  cb(null, s0.product_id)
                }, 5000)
              })
            } else {
              return cb(null)
            }
            
          } else {
            return cb(null)
          }
        }
        
        function cancelAllOrders() {
          console.log("\nCancelling orders")
          for (var i=0; i<ss.length; i++) {
            if (ss[i].api_order) {
              cancelOrder(ss[i], function(err, product_id = null){
                if (err) {
                  console.log(err)
                } else {
                  if (product_id) console.log("Order cancelled for", product_id)
                }
              
              })
            }
          }
        }
        
        
        function reportOrders() {
          var s
          console.log("");
          for (var i=0; i<ss.length; i++) {
            s = ss[i]
            
            profit = s.asset_change * (n(s.quote.bid) + n(s.quote.ask))/2 + s.currency_change
            console.log("Orders for:", s.product_id, "| Asset change:", n(s.asset_change).format('0.00'), " | Currency change:", n(s.currency_change).format('0.00'), "| Profit:", n(profit).format('0.00'));
          }
        }
        
        function updateOrder(s) {
          if (s.api_order) {
            s.engine.getOrder({order_id: s.api_order.id}, function (err, updated_order) {
              if (err) {
                console.error('\ncould not update order'.red)
                return null
              }
              // what happens if order was manually cancelled
              console.log(updated_order.product_id, updated_order.side, ":", updated_order.status)
              
              if (updated_order.status == 'done') {
                s.last_order = s.api_order
                delete s.api_order
                // log the order
                var order_sign
                if (updated_order.side == 'buy') {
                  order_sign = 1
                } else {
                  order_sign = -1
                }
                
                s.asset_change += (order_sign * updated_order.filled_size);
                s.currency_change -= ((order_sign * updated_order.executed_value) - updated_order.fill_fees);
                
                console.log("");
                console.log("Order complete:", updated_order.product_id, "| Asset change:", n(s.asset_change).format('0.00'), " | Currency change:", n(s.currency_change).format('0.00'));
                
                return null
              
              } else {
                s.api_order = updated_order
                setTimeout(function() {updateOrder(s)}, 10000)
              }
              
              
            })
          }
          return null
        }
        
        function placeOrder(opt) {
          var s0
          for (var i=0; i<ss.length; i++) {
            if (ss[i].product_id == opt.product_id) s0 = ss[i]  
          }
          
          var opts = JSON.parse(JSON.stringify(opt))
          opts.post_only = false
          
          // cancel open order first
          cancelOrder(s0, function(err){
            if (err) {
              console.log("can't cancel order for", s0.product_id)
            } else {
              s0.engine.placeLimitOrder(opts.side, opts, function (err, orderS) {
                if (err) {
                  console.error(err)
                  process.exit(1)
                }
                if (!orderS) {
                  console.error('Order incomplete at', opts.price)
                } else {
                  console.log("Limit order placed at", opts.price, "size:", opts.size)
                  // monitor the order
                  updateOrder(s0)
                  
                  //process.exit(1)
                }
              })
            }
          
          })
        }
        

        function undoOrders() {
          var last_order, side, opt
          for (var i=0; i<ss.length; i++) {
            if (ss[i].last_order) {
              if (ss[i].api_order) {
                console.log("Can't undo when there are open orders.")
              } else {
                last_order = ss[i].last_order
                console.log("Undoing last order for", last_order.product_id)
                side = (last_order.side == "buy") ? "sell" : "buy"
                opt = {product_id: last_order.product_id, size: last_order.size, price: last_order.price, side: side}
                placeOrder(opt)
                delete ss[i].last_order
              }
            }
          }
        }
        
        
        function formatDate() {
          var currentdate = new Date(); 
          var datetime = "Last Sync: " + currentdate.getDate() + "/"
            + (currentdate.getMonth()+1)  + "/" 
            + currentdate.getFullYear() + " @ "  
            + currentdate.getHours() + ":"  
            + currentdate.getMinutes() + ":" 
            + currentdate.getSeconds();
          return(datetime)
        }
        
        // update all asset values
        function checkAll(rebalance_now=false, cb=null) {
          var counter = ss.length
          var all_assets = 0
          //var all_balances = []
          var percent
          var err_flag = false
          
          total = function(summary, err=null) {
            // check error
          
            counter = counter-1
            if (err) {
              err_flag = true
            } else {
              all_assets = all_assets + summary.asset_value
            }
            
            if (counter==0) {
              if (err_flag) {
                console.error("Error checking balances")         
                return
              }
            
              var account_value = all_assets + summary.currency_value
              var prices = [] 
              for (var i=0; i<ss.length; i++) {
                summary = ss[i].summary
                prices.push(summary.mid)
                percent = summary.asset_value/account_value
                myLog(summary.product + ": " + Number(summary.asset).toPrecision(4) + " " + summary.ask + " Value: " + summary.asset_value.format('0.00') + " " + n(summary.asset_value/account_value*100).format('0.0') + "%")
              }
              
              myLog("CASH: " + n(summary.currency_value).format('0.00') + " " + n(summary.currency_value/account_value * 100).format('0.0') + "%")
              myLog("TOTAL: " + n(account_value).format('0.00'))
              myLog(formatDate())
              console.log("Auto-rebalance (o):", manual_order)
              
              // update the allocation if triggered by price action
              priceTriggers(account_value, prices, setProp)
              cashTriggers(account_value, cash_target, setTargets)
              
              
              if (cash_target > n(summary.currency_value).divide(account_value) * (1+argv.trigger_pct)) {
                if (!buy_only) {
                  // if cash is too high, execute sell orders only
                  rebalance_now = "sell"
                  console.log("Adjusting cash reserve")
                }
              }
              
              if (cash_target < n(summary.currency_value).divide(account_value) * (1-argv.trigger_pct)) {
                // if cash is too low, execute buy orders only
                rebalance_now = "buy"
                console.log("Adjusting cash reserve")
                
              }
              
              if (argv.rebalance) rebalance(rebalance_now)
              
              if (cb) cb(account_value)
            }
          }
          
          myLog("\n")
          for (var i=0; i<ss.length; i++) {
            getTotalBalance(ss[i], total)          
          }
          
        }
        
        var manual_order = false
        var maker_order = true
        var buy_only = false
        
        // === code from https://www.npmjs.com/package/keypress
        var keypress = require('keypress');

        // make `process.stdin` begin emitting "keypress" events 
        keypress(process.stdin);
         
        // listen for the "keypress" event 
        process.stdin.on('keypress', function (ch, key) {
          //console.log('got "keypress"', key, ch);
          if (ch == '-') {
            setTargets(cash_target - 0.01)
          } else if (ch == '=') {
            setTargets(cash_target + 0.01)
          } else if (key != undefined) {
          
            if (key && (key.ctrl && key.name == 'c') || key.name == 'q') {
              saveSettings(function(err, fd) {
                process.stdin.pause();
                clearInterval(check_interval)
                process.exit();
              })
            } else if (key && key.name == 'o') {
              manual_order = !manual_order
              checkAll()
            } else if (key && key.name == 'b') {
              manual_order = true
              // immediately rebalance at the bid/ask price
              checkAll(rebalance_now = "all")
            } else if (key && key.name == 'f') {
              buy_only = !buy_only
              console.log("Buy orders only:", buy_only)
            } else if (key && key.name == 'r') {
              reportOrders()
            } else if (key && key.name == 'u') {
              undoOrders()
            } else if (key && key.name == 'm') {
              maker_order = !maker_order
              console.log("Use maker orders (m):", maker_order)
            } else if (key && key.name == 'c') {
              cancelAllOrders()
            } else if (key && key.name == 'h') {
              console.log("o: toggle auto rebalance / b: rebalance now / f: toggle buy only / r: report / u: undo / t: select target allocation")
            } else {
              // only show the orders, do not execute
              checkAll(rebalance_now = "check")
            }
          }
        });
         
        process.stdin.setRawMode(true);
        process.stdin.resume();
        // =========
        
        checkAll()
        var check_interval = setInterval(checkAll, argv.poll_time*1000)
        
        
      })
  }
}
