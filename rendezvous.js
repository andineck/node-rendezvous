var http       = require('http')
  , https      = require('https')
  , md5        = require('MD5')
  , net        = require('net')
  , portfinder = require('portfinder')
  , tls        = require('tls')
  , url        = require('url')
  ;


var listeners = {};

/*
 * i have a theory:
 *
 *     https.request(...).on('connect', ...)
 *
 * is broken because the socket passed does ciphertext not plaintext.
 */

exports.listen = function(options) {
  if (!options.keyData) return listen(options);

  portfinder.getPort({ port: 8898 }, function(err, portno) {
    tls.createServer({ key: options.keyData, cert: options.crtData }, function(cleartext) {
      var socket;

      socket = new net.Socket({ allowHalfOpen: true });
      socket.on('connect', function() {
        options.logger.info('connected to http://127.0.0.1' + ':' + portno);

        socket.pipe(cleartext).pipe(socket);
      }).on('error', function(err) {
        options.logger.error('tlsproxy', { event: 'error', diagnostic: err.message });
        try { socket.destroy(); } catch(ex) {}
      }).connect(portno, '127.0.0.1');
    }).on('clientError', function(err) {
      options.logger.info('tlsproxy', { event: 'clientError', diagnostic: err.message });
    }).listen(options.rendezvousPort, options.rendezvousHost, function () {
      options.logger.info('listening on tls://' + options.rendezvousHost + ':'
                          + options.rendezvousPort);

      delete(options.keyData);
      options.rendezvousHost = '127.0.0.1';
      options.rendezvousPort = portno;
      listen(options);
    });
  });
};

var listen = function(options) {
  var server;

  server = (!!options.keyData) ? https.createServer({ key: options.keyData, cert: options.crtData }) : http.createServer();
  server.on('request', function(request, response) {
    var tag, uuid;

    tag = request.socket.remoteAddress + ' ' + request.socket.remotePort;
    options.logger.info('rendezvous', { event: 'request', tag: tag });

    if (!!request.headers.authorization) {
      uuid = getuuid(request);
      if (!uuid) {
        response.writeHead(400);
        return response.end(JSON.stringify({ error: { permanent: true, diagnostic: 'invalid Authorization header' } }));
      }

      return initiate(options, uuid, request, request.socket, response);
    }

    response.writeHead(401, { 'www-authenticate': 'Digest realm="rendezvous", '
                                                + 'qop="auth, auth-int", '
                                                + 'nonce="'  + md5(new Date().getTime()) + '", '
                                                + 'opaque="' + md5('rendezvous') + '"'
                            });
    response.end();
  }).on('connect', function(request, socket, head) {
    var parts, tag, uuid;

    tag = request.socket.remoteAddress + ' ' + request.socket.remotePort;
    options.logger.info('rendezvous', { event: 'connect', tag: tag });

    parts = url.parse(request.url, true);
    if (parts.protocol !== 'uuid:') return loser(socket, 403, 'invalid protocol, should be uuid:');
    if (!parts.query.response)      return loser(socket, 407, 'missing response parameter');
    if (head.length !== 0)          return loser(socket, 409, 'wait for response to CONNECT before sending data');
    uuid = parts.host;

    options.registerUUID(options, uuid, parts.query.response, function(results) {
      options.logger.info('rendezvous', { event: 'register', tag: tag, uuid: uuid, results: results });

      if (!!results.error) return loser(socket, 401, results.error.diagnostic);

      if (!!listeners[uuid]) try { listeners[uuid].socket.destroy(); } catch(ex) {}
      listeners[uuid] = { socket: socket, tag: tag };

      socket.write('HTTP/1.1 200\r\n\r\n');

      socket.on('error', function(err) {
        options.logger.error('rendezvous', { event: 'error', tag: tag, diagnostic: err.message });
      }).on('end', function() {
        options.logger.debug('rendezvous', { event: 'end', tag: tag });
      }).on('close', function(errorP) {
        if (errorP) options.logger.error('rendezvous', { event: 'close', tag: tag });
        else        options.logger.debug('rendezvous', { event: 'close', tag: tag });

        try { if (listeners[uuid].tag === tag) delete(listeners[uuid]); } catch(ex) {}
      });
    });
  }).on('upgrade', function(request, socket, head) {/* jshint unused: false */
    var parts, tag, uuid;

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
    options.logger.info('rendezvous', { event: 'upgrade', tag: tag });

    if (!!request.headers.authorization) {
      uuid = getuuid(request);
      if (!uuid) return loser(socket, 400, 'invalid Authorization header');
    } else {
      parts = url.parse(request.url, true);
      if (!parts.query.rendezvous) {
        response.writeHead(401, { 'www-authenticate': 'Digest realm="rendezvous", '
                                                    + 'qop="auth, auth-int", '
                                                    + 'nonce="'  + md5(new Date().getTime()) + '", '
                                                    + 'opaque="' + md5('rendezvous') + '"'
                                });
        return response.end();
      }
      uuid = parts.query.rendezvous;
    }

    initiate(options, uuid, request, socket, response);
  }).on('clientError', function(err, socket) {/* jshint unused: false */
    options.logger.info('rendezvous', { event: 'clientError', diagnostic: err.message });
  }).listen(options.rendezvousPort, options.rendezvousHost, function () {
    options.logger.info('listening on http' + ((!!options.keyData) ? 's' : '') + '://' + options.rendezvousHost + ':'
                        + options.rendezvousPort);
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

var loser = function(socket, code, diagnostic) {
  socket.write('HTTP/1.1 ' + code + '\r\n\r\n' + JSON.stringify({ error: { permanent: false, diagnostic: diagnostic } }));
  socket.end();
  setTimeout(function() { try { socket.destroy(); } catch(ex) {} }, 1 * 1000);
};

var initiate = function(options, uuid, request, socket, response) {
  var h, hello, listener, parts, responder, tag;

  tag = socket.remoteAddress + ' ' + socket.remotePort;

  if (!listeners[uuid]) {
    response.writeHead(404, {});
    return response.end(JSON.stringify({ error: { permanent: false, diagnostic: 'UUID not registered' } }));
  }
  listener = listeners[uuid].socket;
  responder = listeners[uuid].tag;
  delete(listeners[uuid]);

  options.logger.info('rendezvous', { event: 'initiate', tag: tag, uuid: uuid });

  parts = url.parse(request.url);
  hello = request.method + ' ' + parts.href + ' HTTP/' + request.httpVersion + '\r\n';
  for (h in request.headers) {
    if ((request.headers.hasOwnProperty(h)) && (h !== 'authorization')) hello += h + ': ' + request.headers[h] + '\r\n';
  }
  hello += '\r\n';

  try {
    listener.write(hello);
  } catch(ex) {
    options.logger.error('rendezvous', { event: 'write', tag: responder, diagnostic: ex.message });
  }
  socket.pipe(listener).pipe(socket);
};

