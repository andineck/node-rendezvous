var fs          = require('fs')
  ;


exports.options = { rendezvousHost : '199.223.216.16'
                  , rendezvousPort : 8899

                  , keyData        : fs.readFileSync('./registrar.key')
                  , crtData        : fs.readFileSync('./registrar.crt')

                  , redisHost      : '127.0.0.1'
                  , redisPort      : 6379
                  , redisAuth      : ''
                  };
