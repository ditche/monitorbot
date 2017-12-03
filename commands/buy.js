var minimist = require('minimist')
  , n = require('numbro')
  , colors = require('colors')

module.exports = function container (get, set, clear) {
  var c = get('conf')
  return function (program) {
    program
      .command('buy [selector]')
      .allowUnknownOption()
      .description('execute a buy order to the exchange')
      .option('--type <type>', 'Order type: adjust, limit, market, spread', String, c.type)
      .option('--limit <val>', 'Limit value (limit)', Number, c.limit)
      .option('--spread <val>', 'set buy spread at % below current value with specified amount of money', Number, c.spread)
      .option('--above <type>', 'Trigger the order when price is above this', Number, c.above)
      .option('--below <val>', 'Trigger the order when price is below this value', Number, c.below)
      .option('--post_only <boolean>', 'Default true for limit orders', Boolean, c.post_only)
      .option('--max_val <size>', 'set the maximum amount of dollars to buy with', Number, c.max_val)
      .option('--pct <pct>', 'buy with this % of currency balance', Number, c.buy_pct)
      .option('--size <size>', 'sell specific size of currency')
      .option('--markup_pct <pct>', '% to mark up ask price', Number, c.markup_pct)
      .option('--order_adjust_time <ms>', 'adjust bid on this interval to keep order competitive', Number, c.order_adjust_time)
      .option('--max_slippage_pct <pct>', 'avoid selling at a slippage pct above this float', c.max_slippage_pct)
      .action(function (selector, cmd) {
        var s = {options: minimist(process.argv)}
        var so = s.options
        delete so._
        Object.keys(c).forEach(function (k) {
          if (typeof cmd[k] !== 'undefined') {
            so[k] = cmd[k]
          }
        })
        so.buy_pct = cmd.pct
        so.selector = get('lib.normalize-selector')(selector || c.selector)
        so.mode = 'live'
        so.strategy = c.strategy
        so.stats = true
        if (typeof so.type == 'undefined') so.spread = 'adjust'
        var engine = get('lib.engine')(s)
        
        // If there is a trigger, get quotes until we hit the price
        if (typeof so.above !== 'undefined' || typeof so.below !== 'undefined') {
          console.log("Waiting for price to reach trigger value...");
          (function trigger_hold(){
            engine.getQuote(function(err, quote) {
              if (err) {
                console.log(err)
              } else {
                var mid = (n(quote.ask) + n(quote.bid))/2
                if ((typeof so.above !== 'undefined' &&  mid > so.above) || (typeof so.below !== 'undefined' && mid < so.below)) {
                  // activate the order
                  console.log("Activating sell order at", mid)
                  buyOrder()
                  return
                }
              }
              setTimeout(trigger_hold, so.update_time)
            })
            
          })()
          
        } else {
          buyOrder()
        }
        
        function buyOrder() {
          console.log("BUYING", so.type)
          var new_s = JSON.parse(JSON.stringify(s))
          engine = get('lib.engine')(new_s)
          
          // BUY SPREAD (buy a percent of max_val at percents below current price)
          if (so.type == 'spread') {
            var spread_pct = [so.spread, so.spread*2, so.spread*3]
            var buy_pct = [30, 30, 40]
            console.log("Setting buy limits at %" + so.spread)
            
            engine.getQuote(function(err, quote) {
              counter = 0
              if (!err) {
              
                for (var i = 0; i<spread_pct.length; i++) {
                  so.markup_pct = spread_pct[i]
                  price = n(quote.bid).subtract(n(quote.bid).multiply(so.markup_pct / 100))
                  size = n(so.max_val)*buy_pct[i] /100 /price
                  
                  var opts_buy = {size: n(size).format('0.00000000'), price: price.format("0.00")}
                  console.log("Limit buy at:", opts_buy)
                    
                  engine.placeLimitOrder('buy', opts_buy, function (err, orderB) {
                    if (err) {
                      console.error(err)
                    }
                    if (!orderB) {
                      console.error('buy incomplete')
                    } else {
                      console.log("Limit order placed at", orderB.price)
                    }
                    counter++
                    if (counter==3) process.exit(1)
                  })
                  
                }
              }
            })
          
          
          // LIMIT ORDER
          } else if (so.type=="limit") {
            if (typeof so.size == 'undefined' || typeof so.limit == 'undefined') {
              console.log("Must specify size and limit price")
              process.exit(1)
            }
            
            var opts_buy = {size: so.size, price: n(so.limit).format("0.00")}
            if (typeof so.post_only !== 'undefined') opts_buy.post_only = so.post_only
            console.log(opts_buy)
            
            engine.placeLimitOrder('buy', opts_buy, function (err, orderS) {
              if (err) {
                console.error(err)
                process.exit(1)
              }
              if (!orderS) {
                console.error('Buy incomplete at', opts_buy.price)
              } else {
                console.log("Limit order placed at", opts_buy.price)
                process.exit(1)
              }
            })
            
          // MARKET ORDER
          } else if (so.type=="market") {
            
            if (typeof so.size == 'undefined') {
              console.log("Must specify size")
              process.exit(1)
            }
            
            var opts_buy = {size: so.size, type:'market'}
            console.log(opts_buy)
            
            engine.placeLimitOrder('buy', opts_buy, function (err, orderS) {
              if (err) {
                console.error(err)
                process.exit(1)
              }
              if (!orderS) {
                console.error('Buy incomplete at', opts_buy.price)
                process.exit(1)
              } else {
              // success
                sell_order = orderS
                console.log("Market order placed for", so.size)
                process.exit(1)
                
              }
            })  
            
          // AUTO ADJUST ORDER
          } else {
          
          
            var engine = get('lib.engine')(s)
            engine.executeSignal('buy', function (err, order) {
              if (err) {
                console.error(err)
                process.exit(1)
              }
              if (!order) {
                console.error('not enough currency balance to buy!')
              }
              process.exit()
            }, cmd.size)
            
            function checkOrder () {
              if (s.api_order) {
                s.exchange.getQuote({product_id: s.product_id}, function (err, quote) {
                  if (err) {
                    //throw err
                    console.log("error getting quotes")
                  } else {
                  console.log('order status: '.grey + s.api_order.status.green + ', bid: '.grey + n(s.api_order.price).format('0.00000000').yellow + ', '.grey + n(quote.bid).subtract(s.api_order.price).format('0.00000000').red + ' below best bid, '.grey + n(s.api_order.filled_size).divide(s.api_order.size).format('0.0%').green + ' filled'.grey)
                  }
                })
                  
              }
              else {
                console.log('placing order...')
              }
            }
            setInterval(checkOrder, c.order_poll_time)
          
          
          }
          
        }
        
      })
  }
}
