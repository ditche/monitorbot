var accountSid = 'AC72d0665910232cd4e715c7da35566d1a'; // Your Account SID from www.twilio.com/console
var authToken = 'bfbb3d3aeb37c12846969879e7213d34';   // Your Auth Token from www.twilio.com/console

var twilio = require('twilio');
var client = new twilio(accountSid, authToken);

client.messages.create({
    body: 'Hello from Node',
    to: '+16173047984',  // Text this number
    from: '+7819718265 ' // From a valid Twilio number
})
.then((message) => console.log(message.sid));
