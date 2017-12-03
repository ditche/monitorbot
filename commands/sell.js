var minimist = require('minimist')
  , n = require('numbro')
  , colors = require('colors')

module.exports = function container (get, set, clear) {
  var c = get('conf')
  return function (program) {
    program
      .command('sell [selector]')
      .allowUnknownOption()
      .description('execute a sell order to the exchange')
      .option('--type <type>', 'Order type: adjust, limit, market, trailing', String, c.type)
      .option('--limit <val>', 'Limit value (limit)', Number, c.limit)
      .option('--stop_pct <pct>', 'Trailing stop pct', Number, c.stop_pct)
      .option('--limit_pct <pct>', 'Trailing limit pct', Number, c.limit_pct)
      .option('--peak_window <minutes>', 'Trigger stoplimit if price falls below a % of the highest in this window (trailing)', Number, c.peak_window)
      .option('--above <type>', 'Trigger the order when price is above this', Number, c.above)
      .option('--below <val>', 'Trigger the order when price is below this value', Number, c.below)
      .option('--post_only <boolean>', 'Default true for limit orders', Boolean, c.post_only)
      .option('--max_val <pct>', 'set the maximum percent of asset to sell', Number, c.max_val)
      .option('--pct <pct>', 'sell with this % of max', Number, c.sell_pct)
      .option('--size <size>', 'sell specific size of asset')
      .option('--markup_pct <pct>', '% to mark up ask price', Number, c.markup_pct)
      .option('--update_time <s>', 'seconds between updating the price', Number, c.update_time)
      .option('--order_adjust_time <ms>', 'adjust bid on this interval to keep order competitive', Number, c.order_adjust_time)
      .option('--max_slippage_pct <pct>', 'avoid selling at a slippage pct above this float (adjust)', c.max_slippage_pct)
      .action(function (selector, cmd) {
        var s = {options: minimist(process.argv)}
        var so = s.options
        delete so._
        Object.keys(c).forEach(function (k) {
          if (typeof cmd[k] !== 'undefined') {
            so[k] = cmd[k]
          }
        })
        so.sell_pct = cmd.pct
        so.selector = get('lib.normalize-selector')(selector || c.selector)
        so.mode = 'live'
        so.strategy = c.strategy
        so.stats = true
        if (typeof so.update_time == 'undefined') {
          so.update_time = 10
        }
        so.update_time = so.update_time * 1000
        if (typeof so.type == 'undefined') so.type = 'adjust'
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
                  sellOrder()
                  return
                }
              }
              setTimeout(trigger_hold, so.update_time)
            })
            
          })()
          
        } else {
          sellOrder()
        }
        
        function sellOrder() {
          console.log("SELLING", so.type)
          var new_s = JSON.parse(JSON.stringify(s))
          engine = get('lib.engine')(new_s)
          
          // LIMIT ORDER
          if (so.type=="limit") {
            if (typeof so.size == 'undefined' || typeof so.limit == 'undefined') {
              console.log("Must specify size and limit price")
              process.exit(1)
            }
            
            var opts_sell = {size: so.size, price: n(so.limit).format("0.00")}
            if (typeof so.post_only !== 'undefined') opts_sell.post_only = so.post_only
            console.log(opts_sell)
            
            engine.placeLimitOrder('sell', opts_sell, function (err, orderS) {
              if (err) {
                console.error(err)
                process.exit(1)
              }
              if (!orderS) {
                console.error('sell incomplete at', opts_sell.price)
              } else {
                console.log("Limit order placed at", opts_sell.price)
                process.exit(1)
              }
            })
            
          // MARKET ORDER
          } else if (so.type=="market") {
            
            if (typeof so.size == 'undefined') {
              console.log("Must specify size")
              process.exit(1)
            }
            
            var opts_sell = {size: so.size, type:'market'}
            console.log(opts_sell)
            
            engine.placeLimitOrder('sell', opts_sell, function (err, orderS) {
              if (err) {
                console.error(err)
                process.exit(1)
              }
              if (!orderS) {
                console.error('sell incomplete at', opts_sell.price)
                process.exit(1)
              } else {
              // success
                sell_order = orderS
                console.log("Market order placed for", so.size)
                process.exit(1)
                
              }
            })
          
          // TRAILING STOP LIMIT ORDER
          } else if (so.type=="trailing") {
            
            var high_price
            var trigger_price
            if (typeof so.peak_window == 'undefined') so.peak_window = 60 // in minutes
            if (typeof so.stop_pct == 'undefined') so.stop_pct = 3
            if (typeof so.limit_pct == 'undefined') so.limit_pct = so.stop_pct
            
            console.log("Peak window (minutes):", so.peak_window);
            console.log("Update time (seconds):", so.update_time / 1000);
            (function update_high(){
              engine.getXminstats(so.peak_window, function(err, stats) {
                if (err) {
                } else {
                  high_price = stats[0][2]
                  trigger_price = n(high_price) * (1 - n(so.stop_pct)/100)
                  console.log("High of", high_price, ". Setting stop value at ", trigger_price)
                  setTimeout(update_high, so.peak_window * 1000)
                }
              })
            })()
            
            setTimeout(quotefcn = function(){
              engine.getQuote(function(err, quote){
                if (err) {
                  console.log('Error getting quote')
                } else {
                  if ((n(quote.bid) + n(quote.ask))/2 < trigger_price) {
                    so.limit = n(high_price) * (1 - n(so.limit_pct) / 100)
                    console.log("Sell triggered. Setting limit order at", so.limit)
                    
                    so.type = 'limit'
                    so.post_only = false
                    sellOrder()
                    
                  } else {
                    setTimeout(quotefcn, so.update_time)
                  }
                }
              })
            }, so.update_time)
            
            
          // SELF-ADJUST ORDER (adjust limit order price to outbid, or keep at a fixed % markup)
          } else if (so.type=="adjust") {
          
            engine.executeSignal('sell', function (err, order) {
              if (err) {
                console.error(err)
                process.exit(1)
              }
              if (!order) {
                console.error('not enough asset balance to sell!')
              }
              process.exit()
            }, cmd.size)
            function checkOrder () {
              if (s.api_order) {
                s.exchange.getQuote({product_id: s.product_id}, function (err, quote) {
                  if (err) {
                    throw err
                  }
                  console.log('order status: '.grey + s.api_order.status.green + ', ask: '.grey + n(s.api_order.price).format('0.00000000').yellow + ', '.grey + n(s.api_order.price).subtract(quote.ask).format('0.00000000').red + ' above best ask, '.grey + n(s.api_order.filled_size).divide(s.api_order.size).format('0.0%').green + ' filled'.grey)
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
