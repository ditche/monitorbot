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
      .option('--log <boolean>', 'keep log file (true/false)', Boolean, c.keep_log)
      .action(function (selector, cmd) {
        
        var argv = require('minimist')(process.argv.slice(2));
        if (typeof argv.poll_time == 'undefined') argv.poll_time = 360
        if (typeof argv.keep_log == 'undefined') argv.keep_log = true
        console.log("Polling every (seconds): " + argv.poll_time);
        
        if (argv.keep_log) {
          var log_file = fs.createWriteStream('./gdax.log', {flags : 'a'});
          var log_stdout = process.stdout;
        }

        function myLog(d) { //
          if (argv.keep_log !== true) return
          log_file.write(util.format(d) + '\n');
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
        
        // change these
        s.exchange = get('exchanges.gdax')
        selectors = ['gdax.BTC-USD', 'gdax.ETH-USD', 'gdax.LTC-USD']
        s.currency = 'USD'
        
        // initialize the exchanges
        var ss = []
        for (var i=0; i<selectors.length; i++) {
          var new_s = JSON.parse(JSON.stringify(s))
          new_s.options.selector = selectors[i]
          new_s.options.engine = get('lib.engine')(new_s)
          ss.push(new_s)
        
        }
        //s.product_id = selector_parts[1]
        //s.asset = s.product_id.split('-')[0]
                
        function getTotalBalance (s, cb) {
          s.exchange.getBalance(s, function (err, balance) {
            if (err) {
              console.log(err)
              return cb(err)
              
            }
            
            var summary = {product: s.product_id, asset: balance.asset, currency: balance.currency}

            s.exchange.getQuote({product_id: s.product_id}, function (err, quote) {
              if (err) return cb(err)
              asset_value = n(balance.asset).multiply(quote.ask)
              summary.currency_value = n(balance.currency)
              //myLog(s.product_id + ": " + n(balance.asset).format('0.00') + " " + quote.ask + " Total: " + asset_value.format('0.00'))
              summary.ask = quote.ask
              summary.asset_value = asset_value
              cb(summary)
            })
          })
          
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
        
        checkAll = function() {
          var counter = ss.length
          var all_assets = 0
          var all_balances = []
          total = function(summary) {
            counter = counter-1
            all_assets = all_assets + summary.asset_value
            all_balances.push(summary)
            
            if (counter==0) {
              var account_value = all_assets + summary.currency_value  
              for (var i=0; i<ss.length; i++) {
                summary = all_balances[i]
                myLog(summary.product + ": " + n(summary.asset).format('0.00') + " " + summary.ask + " Value: " + summary.asset_value.format('0.00') + " " + n(summary.asset_value/account_value*100).format('0.0') + "%")
              }
            
              myLog("CASH: " + n(summary.currency_value).format('0.00') + " " + n(summary.currency_value/account_value * 100).format('0.0') + "%")
              myLog("TOTAL: " + n(all_assets + summary.currency_value).format('0.00'))
              myLog(formatDate())
            }
          }
          
          myLog("\n")
          for (var i=0; i<ss.length; i++) {
            getTotalBalance(ss[i], total)          
          }
          
        }
        
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
