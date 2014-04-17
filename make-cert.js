var keygen    = require('x509-keygen').x509_keygen
  , options   = require('./vps').options
  ;

keygen({ subject    : '/CN=' + options.rendezvousHost
       , keyfile    : 'registrar.key'
       , certfile   : 'registrar.crt'
       , alternates : [ 'IP:' + options.rendezvousHost ]
       , destroy    : false
       }, function(err, results) {/* jshint unused: false */
  if (err) return console.log('keypair generation error: ' + err.message);

  console.log('keypair generated.');
});
