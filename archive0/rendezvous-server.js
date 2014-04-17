var net       = require('net')
  , url       = require('url')
  ;

var cookies    = exports.cookies    = {};

exports.listen = function(options) {
  if (!options.rendezvousPort) return options.logger.info('rendezvous not configured for the generic protocol');

  net.createServer({ allowHalfOpen: true }, function (socket) {
    var buffer, diagnostic, listener, mode, tag;

    tag = socket.remoteAddress + ' ' + socket.remotePort;
    options.logger.info('rendezvous', { event: 'connect', tag: tag });

    buffer = '';
    socket.on('data', function(data) {
      var cookie, responder, x;

      options.logger.debug('rendezvous', { event: 'data', tag: ((!!mode) ? (mode + '/') : '') + tag });

      buffer += data.toString();
      x = buffer.indexOf('\n');
      if (x === -1) return;

      mode = buffer.slice(0, 1);
      cookie = buffer.slice(1, x);
      buffer = buffer.slice(x + 1);

      socket.setNoDelay();
      switch (mode) {
        case 'R':
          if (!cookies[cookie])         { diagnostic = 'not registered'; break; }
          if (!!cookies[cookie].socket) try { cookies[cookie].socket.destroy(); } catch(ex) {}
          cookies[cookie].socket = socket;
          cookies[cookie].tag = tag;
          return options.logger.debug('rendezvous', { responder: tag });

        case 'I':
          if (!cookies[cookie])         { diagnostic = 'not registered'; break; }
          if (!cookies[cookie].socket)  { diagnostic = 'not ready';      break; }
          listener = cookies[cookie].socket;
          delete(cookies[cookie].socket);
          responder = cookies[cookie].tag;
          delete(cookies[cookie].tag);
          try {
            socket.write('+OK\n');
          } catch(ex) {
            options.logger.error(tag, { event: 'write', diagnostic: ex.message });
          }
          try {
            listener.write('+OK\n' + buffer);
          } catch(ex) {
            options.logger.error('rendezvous', { event: 'write', tag: responder, diagnostic: ex.message });
          }
          socket.removeAllListeners('data');
          socket.pipe(listener);
          listener.removeAllListeners('data');
          listener.pipe(socket);
          return options.logger.debug('rendezvous', { initiator: tag, responder: responder });

        default:
          diagnostic = 'invalid cookie';
          break;
      }
      options.logger.error('rendezvous',
                           { event: 'data', tag: mode + '/' + tag, diagnostic: diagnostic, cookie: (mode + cookie) });
      try { socket.write('-ERR ' + diagnostic + '\n', function() { socket.destroy(); }); } catch(ex) {}
    }).on('error', function(err) {
      options.logger.error('rendezvous', { event: 'error', tag: mode + '/' + tag, diagnostic: err.message });
    }).on('end', function() {
      options.logger.debug('rendezvous', { event: 'end', tag: mode + '/' + tag });
    }).on('close', function(errorP) {
      if (errorP) options.logger.error('rendezvous', { event: 'close', tag: mode + '/' + tag });
      else        options.logger.debug('rendezvous', { event: 'close', tag: mode + '/' + tag });
    });
  }).listen(options.rendezvousPort, options.rendezvousHost, function() {
    options.logger.info('rendezvous listening on tcp://' + options.rendezvousHost + ':' + options.rendezvousPort);
  });
};

exports.respond = function(options, request, socket, cookie) {
  var tag;

  tag = request.socket.remoteAddress + ' ' + request.socket.remotePort;

  if (!cookies[cookie]) {
    options.logger.error('rendezvous', { event: 'internal error', responder: tag });
    return false;
  }
  if (!!cookies[cookie].socket) try { cookies[cookie].socket.destroy(); } catch(ex) {}
  cookies[cookie].socket = socket;
  cookies[cookie].tag = tag;
  cookies[cookie].httpP = true;
  options.logger.debug('rendezvous', { responder: tag });
  return true;
};

exports.initiate = function(options, uuid, request, nocode, response) {
  var cookie, h, hello, listener, parts, responder, results, tag;

  tag = request.socket.remoteAddress + ' ' + request.socket.remotePort;

  parts = url.parse(request.url, true);
  results = options.lookupUUID(options, uuid);
  options.logger.debug('rendezvous', { event: 'lookup', tag: tag, results: results });

  if (!!results.error) {
    response.writeHead(nocode, {});
    response.end(JSON.stringify({ error: { permanent: false, diagnostic: results.error.diagnostic } }));
    return true;
  }
  cookie = results.result.cookie.slice(1);

  if ((!cookies[cookie]) || (!cookies[cookie].socket) || (!cookies[cookie].httpP)) return false;
  listener = cookies[cookie].socket;
  delete(cookies[cookie].socket);
  responder = cookies[cookie].tag;
  delete(cookies[cookie].tag);
  delete(cookies[cookie].httpP);

  hello = request.method + ' ' + parts.path + ' HTTP/' + request.httpVersion + '\r\n';
  for (h in request.headers) {
    if ((request.headers.hasOwnProperty(h)) && (h !== 'authorization')) hello += h + ': ' + request.headers[h] + '\r\n';
  }
  hello += '\r\n';

  try {
    listener.write(hello);
  } catch(ex) {
    options.logger.error('rendezvous', { event: 'write', tag: responder, diagnostic: ex.message });
  }
  request.socket.pipe(listener);
  listener.pipe(request.socket);
  return true;
};
