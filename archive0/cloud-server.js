var redis     = require('redis')
  , speakeasy = require('speakeasy')
  , uuidV4    = require('node-uuid').v4
  , winston   = require('winston')
  , options   = require('./local').options
  , vous      = require('./rendezvous-server')
  ;

if (options.redisHost === '127.0.0.1') {
  require('nedis').createServer({ server: options.redisHost, port: options.redisPort }).listen(options.redisPort);
}


options.logger = new (winston.Logger)({ transports : [ new (winston.transports.Console)({ level    : 'error'      })
                                                     , new (winston.transports.File)   ({ filename : 'server.log' })
                                                     ]
                                      });
options.logger.setLevels(winston.config.syslog.levels);


var startP = false;
var client = redis.createClient(options.redisPort, options.redisHost, { parser: 'javascript' });
client.auth(options.redisAuth, function(err) {
  if (err) throw err;
});
client.on('ready', function() {
  if (startP) return;
  startP = true;

  options.logger.info('redis starting');
  require('./registration-server').listen(options);
  vous.listen(options);
}).on('connect',  function() {
}).on('error',  function(err) {
  options.logger.error('redis error: ' + err.message);
  throw err;
}).on('end',  function() {
});


var responders = {};

options.lookupUUID = function(options, uuid) {
  if (!responders[uuid]) return { error: { permanent: false, diagnostic: 'not registered' } };

  return { result: { host: options.rendezvousHost, port: options.rendezvousPort, cookie: 'I' +  responders[uuid] } };
};

options.registerUUID = function(options, uuid, response, cb) {
  if (response.length < 6) return { error: { permanent: true, diagnostic: 'invalid request' } };

  client.get(uuid, function(err, reply) {
    var cookie, entry, otp;

    if (err)              return cb({ error: { permanent: false, diagnostic: err.message       } });
    if (reply === null)   return cb({ error: { permanent: false, diagnostic: 'invalid request' } });

    try { entry = JSON.parse(reply); } catch(ex) {
                          return cb({ error: { permanent: false, diagnostic: 'internal error'  } });
    }

    otp = speakeasy.totp({ key      : entry.authParams.base32
                         , length   : response.length
                         , encoding : 'base32'
                         , step     : entry.authParams.step });
    if (otp !== response) return cb({ error: { permanent: false, diagnostic: 'invalid request' } });

    if (!!responders[uuid]) {
      cookie = responders[uuid];
      delete(responders[uuid]);
      delete(vous.cookies[cookie]);
    }

    cookie = uuidV4();
    responders[uuid] = cookie;
    vous.cookies[cookie] = {};
    cb ({ result: { host: options.rendezvousHost, port: options.rendezvousPort, cookie: 'R' + cookie } });
  });
};
