var http      = require('http')
  , https     = require('https')
  , md5       = require('MD5')
  , url       = require('url')
  , vous      = require('./rendezvous-server')
  ;


exports.listen = function(options) {
  var server;

  var responder =  function(request, response) {
    var method, parts, result, tag, uuid;

    tag = request.socket.remoteAddress + ' ' + request.socket.remotePort;
    options.logger.info('registrar', { event: 'request', tag: tag });

// is this the mobile client doing the HTTP-specific protocol?
    if (!!request.headers.authorization) {
      uuid = getuuid(request);
      if (!uuid) {
        response.writeHead(400);
        return response.end(JSON.stringify({ error: { permanent: true, diagnostic: 'invalid Authorization: header' } }));
      }

     if (vous.initiate(options, uuid, request, 200, response)) return;
    }

    parts = url.parse(request.url, true);
    if (!!parts.query.rendezvous) {
      response.writeHead(401, { 'www-authenticate': 'Digest realm="rendezvous", '
                                                  + 'qop="auth, auth-int", '
                                                  + 'nonce="'  + md5(new Date().getTime()) + '", '
                                                  + 'opaque="' + md5('rendezvous') + '"'
                               });
      return response.end();
    }

// otherwise, this is the generic protocol, and the response parameter indicates that the client is a hidden server
    if (!options.rendezvousPort) {
      response.writeHead(404);
      response.end(JSON.stringify({ error: { permanent: true, diagnostic: 'not configured for the generic protcool' } }));
      return;
    }

    if (!parts.query.uuid) {
      response.writeHead(404);
      response.end(JSON.stringify({ error: { permanent: true, diagnostic: 'missing uuid parameter' } }));
      return;
    }

    method = (!!parts.query.response) ? 'PUT' : 'GET';
    if (request.method !== method) {
      response.writeHead(405, { Allow: method });
      response.end(JSON.stringify({ error: { permanent  :  true
                                           , diagnostic : 'expecting ' + method + ' not ' + request.method
                                           } }));
      return;
    }

    if (method === 'GET') {
      result = options.lookupUUID(options, parts.query.uuid);
      options.logger.debug('registrar', { event: 'lookup', tag: tag, results: result });

      response.writeHead(200, {});
      response.end(JSON.stringify(result));
    } else options.registerUUID(options, parts.query.uuid, parts.query.response, function(result) {
      options.logger.debug('registrar', { event: 'register', tag: tag, results: result });

      response.writeHead(200, {});
      response.end(JSON.stringify(result));
    });

    request.setEncoding('utf8');
    request.on('data', function(data) {
      options.logger.debug('registrar', { event: 'data', tag: tag, octets: data.toString().length });
    }).on('close', function() {
      options.logger.error('registrar', { event: 'close', tag: tag });
    }).on('end', function() {
      options.logger.debug('registrar', { event: 'end', tag: tag });
    });
  };

  server = (!!options.keyData) ? https.createServer({ key: options.keyData, cert: options.crtData }, responder)
                               : http.createServer(responder);
  server.on('connect', function(request, socket, head) {
    var parts, tag;

    var loser = function(code, diagnostic) {
      socket.write('HTTP/1.1 ' + code + '\r\n\r\n' + JSON.stringify({ error: { permanent: false, diagnostic: diagnostic } }));
      socket.end();
      setTimeout(function() { try { socket.destroy(); } catch(ex) {} }, 1 * 1000);
    };

    tag = request.socket.remoteAddress + ' ' + request.socket.remotePort;
    options.logger.info('registrar', { event: 'connect', tag: tag });

    parts = url.parse(request.url, true);
    if (parts.protocol !== 'uuid:') return loser(403, 'invalid protocol, should be uuid:');
    if (!parts.query.response)      return loser(407, 'missing response parameter');
    if (head.length !== 0)          return loser(409, 'wait for response to CONNECT before sending data');

    options.registerUUID(options, parts.host, parts.query.response, function(results) {
      var cookie;

      options.logger.debug('registrar', { event: 'register', tag: tag, results: results });

      if (!!results.error) return loser(401, results.error.diagnostic);
      cookie = results.result.cookie.slice(1);

      if (!vous.respond(options, request, socket, cookie)) loser(500, 'internal error');
      socket.write('HTTP/1.1 200\r\n\r\n');

      socket.on('error', function(err) {
        options.logger.error('registrar', { event: 'error', tag: tag, diagnostic: err.message });
      }).on('end', function() {
        options.logger.debug('registrar', { event: 'end', tag: tag });
      }).on('close', function(errorP) {
        if (errorP) options.logger.error('rendezvous', { event: 'close', tag: tag });
        else        options.logger.debug('rendezvous', { event: 'close', tag: tag });
      });

      options.logger.debug('');
    });
  }).on('upgrade', function(request, socket, head) {/* jshint unused: false */
    var parts, tag, uuid;

    var loser = function(code, diagnostic) {
      socket.write('HTTP/1.1 ' + code + '\r\n\r\n' + JSON.stringify({ error: { permanent: false, diagnostic: diagnostic } }));
      socket.end();
      setTimeout(function() { try { socket.destroy(); } catch(ex) {} }, 1 * 1000);
    };

    var response = {
      writeHead : function(code, headers) {
        var bye, h;

        bye = 'HTTP/1.1 ' + code + '\r\n';
        if (!!headers) for (h in headers) if (headers.hasOwnProperty(h)) bye += h + ': ' + headers[h] + '\r\n';
        socket.write(bye + '\r\n');
      }

    , end       : function(s) {
        socket.end(s);
        setTimeout(function() { try { socket.destroy(); } catch(ex) {} }, 1 * 1000);
      }
    };

    tag = request.socket.remoteAddress + ' ' + request.socket.remotePort;
    options.logger.info('registrar', { event: 'upgrade', tag: tag });

    if (!!request.headers.authorization) {
      uuid = getuuid(request);
      if (!uuid) return loser(404, 'missing uuid parameter');
    } else {
      parts = url.parse(request.url, true);
      if (!parts.query.uuid) {
        response.writeHead(401, { 'www-authenticate': 'Digest realm="rendezvous", '
                                                    + 'qop="auth, auth-int", '
                                                    + 'nonce="'  + md5(new Date().getTime()) + '", '
                                                    + 'opaque="' + md5('rendezvous') + '"'
                                 });
        return response.end();
      }
      uuid = parts.query.uuid;
    }

    if (!vous.initiate(options, uuid, request, 404, response)) loser(500, 'internal error');
  }).on('clientError', function(err, socket) {/* jshint unused: false */
    options.logger.info('registrar', { event: 'clientError', diagnostic: err.message });
  }).listen(options.registrarPort, options.registrarHost, function () {
    options.logger.info('registrar listening on https://' + options.registrarHost + ':' + options.registrarPort);
  });
};

var getuuid = function(request) {
  var auth, tokens, x;

  try {
    auth = request.headers.authorization;
    x = auth.indexOf(' ');
    if (x === -1) throw new Error('no space in authentication header: ' + auth);
    switch(auth.slice(0, x)) {
      case 'Basic':
        auth = new Buffer(auth.slice(x + 1), 'base64').toString();
        x = auth.indexOf(':');
        if (x < 1) throw new Error('empty username parameter');
        return auth.slice(0, x);

      case 'Digest':
        // parsing from https://github.com/gevorg/http-auth/blob/master/lib/auth/digest.js, thanks!!!
        auth = auth.replace(/\\"/g, "&quot;").replace(/(\w+)=([^," ]+)/g, '$1=\"$2\"');
        tokens = auth.match(/(\w+)="([^"]*)"/g);
        for (x = 0; x < tokens.length; x++) if (tokens[x].indexOf('username=') === 0) break;
        if (x >= tokens.length) throw new Error('no username parameter');
        return tokens[x].slice(10, -1);

      default:
        throw new Error('unknown authentication type in authentication header: ' + auth);
    }
  } catch(ex) {}

  return null;
};
