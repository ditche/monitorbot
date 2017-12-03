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
        
        // ===== Asset allocation settings =======
        s.exchange = get('exchanges.gdax')
        selectors = ['gdax.BTC-USD', 'gdax.ETH-USD', 'gdax.LTC-USD']
        long_targets = [.1, .61, .19]     // 10% cash
        balance_targets = [.08, .52, .15]  // 25% cash
        short_targets = [.05, .45, .10]   // 40% cash
        targets = [.09, .59, .16]
        cash_target = 1 - targets.reduce(function(a, b) { return a + b; }, 0);
        s.currency = 'USD'
        
        // initialize the exchanges
        var ss = []
        for (var i=0; i<selectors.length; i++) {
          var new_s = JSON.parse(JSON.stringify(s))
          new_s.options.selector = selectors[i]
          new_s.options.mode = "live"
          new_s.engine = get('lib.engine')(new_s)
          new_s.target_pct = targets[i]
          var selector_parts = selectors[i].split('.')
          new_s.product_id = selector_parts[1]
          new_s.asset_change = 0
          new_s.currency_change = 0
          
          ss.push(new_s)
        
        }
        
        // switch between long, short, and balance targets
        function cycleTargets() {
          if (targets == long_targets) {
            targets = balance_targets
          } else if (targets == balance_targets) {
            targets = short_targets
          } else if (targets == short_targets) {
            targets = long_targets
          }
          
          cash_target = 1 - targets.reduce(function(a, b) { return a + b; }, 0);
          for (var i=0; i<selectors.length; i++) {
            ss[i].target_pct = targets[i]
            
          }
          console.log("Targets percentages for", selectors, ":", targets)
        }

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
            
            var summary = {product: s.product_id, asset: balance.asset, currency: balance.currency}

            s.exchange.getQuote({product_id: s.product_id}, function (err, quote) {
              if (err) return cb(err)
              s.quote = quote
              asset_value = n(balance.asset).multiply(quote.ask)
              summary.currency_value = n(balance.currency)
              //myLog(s.product_id + ": " + n(balance.asset).format('0.00') + " " + quote.ask + " Total: " + asset_value.format('0.00'))
              summary.ask = quote.ask
              summary.bid = quote.bid
              summary.mid = 0.5 * n(quote.ask).add(quote.bid)
              if (!s.traded_price) s.traded_price = summary.mid
              summary.traded_price = s.traded_price
              summary.asset_value = asset_value
              summary.target_pct = s.target_pct
              cb(summary)
            })
          })
          
        }
        
        // rebalance all products (and cash) to match the target allocation
        function rebalance(all_balances, rebalance_now) {
          var account_value = all_balances[0].currency_value
          
          for (var i=0; i<all_balances.length; i++) {
            summary = all_balances[i]
            account_value += summary.asset_value
          }
          
          var target_val, target_price, size, trigger_pct
          var order_list = []
          
          // immediately rebalance without waiting for the trigger
          if (rebalance_now) {
            trigger_pct = 0.001
          } else {
            trigger_pct = argv.trigger_pct
          }
          
          for (var i=0; i<all_balances.length; i++) {
            summary = all_balances[i]
            target_value = summary.target_pct * account_value

            if (target_value > summary.asset_value * (1+trigger_pct)) {
              size = (target_value-summary.asset_value) / summary.ask
              if (size > 0.01) {
                console.log("Buy ", summary.product ,"with", n(target_value-summary.asset_value).format('0.00'), "size:", n(size).format('0.000'), "for", summary.target_pct)
                //size = 0.01
                opt = {product_id: summary.product, size: size, price: summary.ask, side: "buy"}
                order_list.push(opt)
              }
            } else if (buy_only==false && target_value < summary.asset_value * (1-trigger_pct)) {
              size = (summary.asset_value-target_value) / summary.bid
              if (size > 0.01) {
                console.log("Sell ", summary.product ,"with", n(summary.asset_value - target_value).format('0.00'), "size:", n(size).format('0.000'), "for", summary.target_pct)
                //size = 0.010                                                                   
                opt = {product_id: summary.product, size: size, price: summary.bid, side: "sell"}
                order_list.unshift(opt)
              }
            }
          }
          // execute the orders
          for (var i=0; i<order_list.length; i++) {
            if (argv.auto || manual_order) placeOrder(order_list[i])
          }
        }
        
        function cancelOrder(s0, cb) {
          if (s0.api_order) {
            if (s0.api_order.status == 'open') {
              s0.exchange.cancelOrder({order_id: s0.api_order.id}, function (err) {
                if (err) {
                  console.error('\ncould not cancel order for adjustment'.red)
                  return cb(err)
                }
                delete s0.api_order
                // wait a bit for settlement
                setTimeout(function () {
                  cb(null)
                }, 5000)
              })
            } else {
              return cb(null)
            }
            
          } else {
            return cb(null)
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
              if (err) return null
              // what happens if order was manually cancelled
              
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
        
        checkAll = function(rebalance_now=false) {
          var counter = ss.length
          var all_assets = 0
          var all_balances = []
          var percent
          var err_flag = false
          
          total = function(summary, err=null) {
            // check error
          
            counter = counter-1
            if (err) {
              err_flag = true
            } else {
              all_assets = all_assets + summary.asset_value
              all_balances.push(summary)
            }
            
            
            if (counter==0) {
              if (err_flag) {
                console.error("Error checking balances")         
                return
              }
            
              var account_value = all_assets + summary.currency_value  
              for (var i=0; i<ss.length; i++) {
                summary = all_balances[i]
                percent = summary.asset_value/account_value
                myLog(summary.product + ": " + n(summary.asset).format('0.00') + " " + summary.ask + " Value: " + summary.asset_value.format('0.00') + " " + n(summary.asset_value/account_value*100).format('0.0') + "%")
              }
              
              myLog("CASH: " + n(summary.currency_value).format('0.00') + " " + n(summary.currency_value/account_value * 100).format('0.0') + "%")
              myLog("TOTAL: " + n(account_value).format('0.00'))
              myLog(formatDate())
              console.log("Auto-rebalance (o):", manual_order)
              
              if (cash_target > n(summary.currency_value).divide(account_value) * (1+argv.trigger_pct)) {
                if (!buy_only) {
                  rebalance_now = true
                  console.log("Adjusting cash reserve")
                }
              }
              
              if (cash_target < n(summary.currency_value).divide(account_value) * (1-argv.trigger_pct)) {
                if (!buy_only) {
                  rebalance_now = true
                  console.log("Adjusting cash reserve")
                }
              }
              
              if (argv.rebalance) {
                rebalance(all_balances, rebalance_now)
              }
            }
          }
          
          myLog("\n")
          for (var i=0; i<ss.length; i++) {
            getTotalBalance(ss[i], total)          
          }
          
        }
        
        var manual_order = false
        var buy_only = false
        
        // === code from https://www.npmjs.com/package/keypress
        var keypress = require('keypress');

        // make `process.stdin` begin emitting "keypress" events 
        keypress(process.stdin);
         
        // listen for the "keypress" event 
        process.stdin.on('keypress', function (ch, key) {
          //console.log('got "keypress"', key);
          if (key && (key.ctrl && key.name == 'c') || key.name == 'q') {
            process.stdin.pause();
            clearInterval()
            process.exit();
          } else if (key && key.name == 'o') {
            manual_order = !manual_order
            checkAll()
          } else if (key && key.name == 'b') {
            manual_order = true
            checkAll(true)
          } else if (key && key.name == 'f') {
            buy_only = !buy_only
            console.log("Buy orders only:", buy_only)
          } else if (key && key.name == 'r') {
            reportOrders()
          } else if (key && key.name == 'u') {
            undoOrders()
          } else if (key && key.name == 't') {
            cycleTargets()
          } else {
            checkAll()
          }
        });
         
        process.stdin.setRawMode(true);
        process.stdin.resume();
        // =========
        
        checkAll()
        setInterval(checkAll, argv.poll_time*1000)
        
        
      })
  }
}
