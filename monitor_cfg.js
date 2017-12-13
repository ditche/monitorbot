        // trading pairs are ['gdax.BTC-USD', 'gdax.ETH-USD', 'gdax.LTC-USD']
        
        // Triggers, balance allocation based on price
        priceTriggers = function (val, prices, cb) {
          var targ
          if (prices[1]/prices[0] > .07) {
            targ = [0.170, 0.5200, 0.2100]
            cb(targ)
          }
          
        }
        
        // Triggers, updates the cash_target based on value
        // val: current cash value
        // params: can be set to anything. right now it's the cash_target percent
        // cb: callback function to set the target
        cashTriggers = function (val, params=null, cb) {
          var targ = params
          var cash_target = params
          // price rising
          if (val > 36000 && cash_target < 0.15) targ = 0.15
          if (val > 39000 && cash_target < 0.155) targ= 0.155
          if (val > 42000 && cash_target < 0.16) targ = 0.16
          if (val > 44000 && cash_target < 0.17) targ = 0.17
          if (val > 47000 && cash_target < 0.18) targ = 0.18
          if (val > 49000 && cash_target < 0.19) targ = 0.19
          if (val > 51000 && cash_target < 0.20) targ = 0.20
          if (val > 54000 && cash_target < 0.22) targ = 0.22
          if (val > 56000 && cash_target < 0.25) targ = 0.25
          //if (val > 57000 && cash_target < 0.24) targ = 0.24
          //if (val > 58500 && cash_target < 0.26) targ = 0.26
          if (val > 60000 && cash_target < 0.28) targ = 0.28
          if (val > 63000 && cash_target < 0.33) targ = 0.33
          
          // price dropping
          if (val < 61500 && cash_target > 0.28) targ = 0.28
          if (val < 53500 && cash_target > 0.20) targ = 0.20
          if (val < 50500 && cash_target > 0.19) targ = 0.19
          if (val < 48500 && cash_target > 0.18) targ = 0.18
          if (val < 46500 && cash_target > 0.17) targ = 0.17
          if (val < 43500 && cash_target > 0.16) targ = 0.16
          if (val < 41500 && cash_target > 0.155) targ = 0.155
          if (val < 38500 && cash_target > 0.15) targ = 0.15
          if (val < 35500 && cash_target > 0.14) {
            targ = 0.14
            buy_only = true
          } 
          
          // if target is changed, set it for each asset
          if (targ != cash_target) cb(targ)
        }
