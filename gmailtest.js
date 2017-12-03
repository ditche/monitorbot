'use strict';
const nodemailer = require('nodemailer');

// create reusable transporter object using the default SMTP transport
let transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // secure:true for port 465, secure:false for port 587
    auth: {
        user: 'an4mus@gmail.com',
        pass: 'gmail1013'
    }
});

// setup email data with unicode symbols
let mailOptions = {
    from: '"Li Wang" <an4mus@gmail.com>', // sender address
    to: '6173047984@tmomail.net', // list of receivers
    subject: 'Hello', // Subject line
    text: 'Hello world ?', // plain text body
};

// send mail with defined transport object
transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
        return console.log(error);
    }
    console.log('Message %s sent: %s', info.messageId, info.response);
});
