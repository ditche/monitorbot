var minimist = require('minimist')
  , n = require('numbro')
  , colors = require('colors')

module.exports = function container (get, set, clear) {
  var c = get('conf')
  return function (program) {
    program
      .command('maker [selector]')
      .allowUnknownOption()
      .description('execute a bracket order to the exchange')
      .option('--spread_scale <val>', 'set price spread scale (default 1)', Number, c.spread_scale)
      .option('--brackets <val>', 'set number of brackets', Number, c.brackets)
      .option('--max_val <size>', 'set the maximum amount of dollars to buy with', Number, c.max_val)
      .option('--spread_val <val>', 'set spread in terms of book depth', Number, c.spread_val)
      .action(function (selector, cmd) {
        var s = {options: minimist(process.argv)}
        var so = s.options
        delete so._
        Object.keys(c).forEach(function (k) {
          if (typeof cmd[k] !== 'undefined') {
            so[k] = cmd[k]
          }
        })
        so.selector = get('lib.normalize-selector')(selector || c.selector)
        so.mode = 'live'
        so.strategy = c.strategy
        so.stats = true
        if (typeof so.brackets === "undefined") so.brackets = 3
        //so.order_poll_time = c.order_poll_time
        if (typeof so.spread_val === "undefined") so.spread_val = 10000
        so.order_poll_time = 1000
        so.update_time = 1000
        so.bidSpread = .2
        so.askSpread = .2
        if (typeof so.spread_scale === "undefined") so.spread_scale = 1  // how much money should the spread be to each side
        so.spread_target = 0.1   // the spread should be at least this wide to open bracket
        so.min_spread = 0.005    // fraction of the price for minimum spread
        
        var total_profit = 0
        
        var temp = JSON.parse(JSON.stringify(s))
        var engine = get('lib.engine')(temp)
        
        console.log("Opening brackets:", so.brackets, so.spread_scale, so.spread_val)
        
        engine.getDayStats(function(err, stats) {
          console.log("-----")
          if (err) console.err(err)
          //console.log(stats)
        })
        
        // find the ask price with "val" amount of cumulative support
        // "book" should only contain the bids or asks
        function findSpread(val, book) {
          var cum = 0
          for (var i=0; i<book.length; i++) {
            cum += n(book[i][0]) * n(book[i][1])
            if (cum > val) return book[i][0]
          }
          return Number(book[book.length-1][0])
        }
        
        // update spread values
        function updateSpread(cb) {
          engine.get5minstats(function(err, stats) {
            if (err) console.err(err)
            var fiveMinVolume = stats[0][5]
            
            engine.getBook(function(err, book) {
              if (err) console.err(err)
              var price = (n(book.bids[0][0]) + n(book.asks[0][0])) / 2
              so.spread_val = price * fiveMinVolume * so.spread_scale
              var bidRange = findSpread(so.spread_val, book.bids)
              var askRange = findSpread(so.spread_val, book.asks)
              
              //console.log(so.spread_val, price, price-bidRange, askRange-price)
              cb(price, price-bidRange, askRange-price)
            })
          })
        }
        
        // saving the state variables
        var mid, left, right, buy_size, sell_size
        var brackets = []
        
        // initialize brackets
        updateSpread(function(price, bidSpread, askSpread) {
          mid = price
          buy_size = so.max_val / so.brackets
          sell_size = buy_size / mid
          sell_size = sell_size.toFixed(4)
          if (sell_size < 0.01) sell_size = 0.01
          
          console.log(price, bidSpread, askSpread)
          
          if (bidSpread > 0.01 * so.brackets && askSpread > 0.01 * so.brackets &&
           bidSpread + askSpread > mid * so.min_spread || true){
            // open bracket orders
            brackets = []
            for (var i=0; i < so.brackets; i++) {
              right = mid + (1+i)*askSpread/so.brackets
              left = mid - (1+i)*bidSpread/so.brackets
              // move the outermost bracket inward to avoid walls
              if (i == so.brackets-1) {
                left += 0.01
                right -= 0.01
              }
              console.log("opening bracket positions at: ", left, right)
              brackets.push(new Bracket(sell_size, mid, right, left, i))
              brackets[i].update()
            }
          }
        
        })
        
        so.update_time = 6000
        // update loop
        setInterval(function(){
          // update spread
          updateSpread(function(price, bidSpread, askSpread) {
            mid = price
            buy_size = so.max_val / so.brackets
            sell_size = buy_size / mid
            sell_size = sell_size.toFixed(4)
            if (sell_size < 0.01) sell_size = 0.01
            
            //console.log("=====spread: ", price, bidSpread, askSpread)
            
          })
          // check bracket status
          console.log("===bracket status===")
          var completed = 0
          for (var i=0; i<brackets.length; i++) {
            console.log(brackets[i].getStatus())
            //if (brackets[i].getStatus() == )
            // if done then try to re-open the bracket
          }
          
          // show cumulative stats
          
        }, so.update_time)
        
        // key monitor
             
        
        function Bracket(size, mid, right, left, mult) {
          var i = i
          var size = size
          var mid = mid
          var buy_order = {status: "none"}
          var sell_order = {status: "none"}
          var opts_buy = {size: size, price: n(left).format("0.00")}
          var opts_sell = {size: size, price: n(right).format("0.00")}
          var multiplier = mult
          var new_s = JSON.parse(JSON.stringify(s))
          var engine = get('lib.engine')(new_s)
          
          this.profit = (right - left)*size
          
          function checkOrder (order) {
            engine.getOrder({order_id: order.order_id, product_id: s.product_id}, function (err, api_order) {
              if (err) {
                console.log("Error checking order")
                if (err.status == 404) return
                return
              } else {
                if (api_order.side == "buy") {
                  buy_order.status = api_order.status
                } else {
                  sell_order.status = api_order.status
                }
                //console.log(buy_order.status, sell_order.status)
                if (api_order.status === 'done') {
                  console.log("order done for", mult, api_order.side)
                  order.time = new Date(api_order.done_at).getTime()
                  
                  if (buy_order.status === 'done' && sell_order.status === 'done') {
                    console.log("bracket filled for profit of: ", (right-left) * size)
                  }
                  return
                }
              }
              setTimeout(checkOrder, so.order_poll_time, order)
            })
          }
          
          update = function(quote=null){
            if ((buy_order.status == "done" && sell_order.status == "done") ||
                (buy_order.status == "none" && sell_order.status == "none")) {
                
              buy_order.status == "none"
              sell_order.status == "none"
              // open the bracket
              console.log('placing order', opts_buy, opts_sell)
              engine.placeLimitOrder('buy', opts_buy, function (err, orderB) {
                if (err) {
                  console.error(err)
                  process.exit(1)
                }
                if (!orderB) {
                  console.error('buy incomplete at', opts_buy.price)
                  buy_order.status = "incomplete"
                } else {
                // success
                  buy_order = orderB
                  //console.log("buy returned =====", mult, buy_order.price)
                  setTimeout(checkOrder, so.order_poll_time, buy_order)
                  
                }
              })
              
              engine.placeLimitOrder('sell', opts_sell, function (err, orderS) {
                if (err) {
                  console.error(err)
                  process.exit(1)
                }
                if (!orderS) {
                  console.error('sell incomplete at', opts_sell.price)
                  sell_order.status = "incomplete"
                } else {
                // success
                  sell_order = orderS
                  //console.log("sell returned =====", mult, sell_order.price)
                  setTimeout(checkOrder, so.order_poll_time, sell_order)
                }
              })
            } else {
              // check orders
              
            }
					}
					         
          // public functions
          return {
            // move mid point to another price
            move_mid: function(mid) {
              this.mid = mid
              this.opts_buy = {size: size, 
                price: n(mid - spread).format("0.00")}
              this.opts_sell = {size: size,
                price: n(mid + spread).format("0.00")}
            },
            // returns the status
            getStatus: function() {
              return [buy_order.status, sell_order.status]
            },
            
            // update bracket with new price info
            update: update,
            // cancel any open orders
            cancel: function(){
            
            },
            // 
          }
        }
        
        
        
      })

	}
}
