node-rendezvous
===============
Straight-forward rendezvous for 'hidden servers' (behind firewalls/NATs) and 'mobile clients' using a third-party service.

This package implements an HTTP-specific protocol that will allow an HTTP connection from the mobile client to the hidden
server.

The hidden server uses HTTPS and the CONNECT method both to authenticate itself and wait for a rendezvous.
The mobile client establishes an HTTPS connection to the rendezvous server,
and specifies the identity of the hidden server.
At this point the rendezvous server moves the octets back-and-forth.

The protocol may be provisioned using a [PAAS](http://en.wikipedia.org/wiki/Platform_as_a_service) provider,
_if_ that service transparently supports the HTTP CONNECT method.
Otherwise, deployment must be provisioned using a [VPS](http://en.wikipedia.org/wiki/Virtual_private_server).

    ATTN PAAS providers: if your service transparently supports the HTTP
    connect method, please contact the repository maintainer! I would very
    much like to use your service as a paying customer...

_Note that I haven't found a PAAS provider that supports CONNECT, so i'm using a VPS instead._

## Protocol specification

The protocol:

1. The rendezvous server resides at a well-known location in the Internet, e.g.,

        https://rendezvous.example.com/

2. The hidden server establishes an HTTPS connection to the rendezvous server,
and authenticates using the CONNECT method, e.g.,

        CONNECT uuid:ID?response=TKN HTTP/1.1

    where 'ID' is administratively assigned by the provider of the rendezvous server,
and TKN is a one-time authentication token.

3. If the hidden server successfully authenticates itself,
then the rendezvous server sends:

        HTTP/1.1 200 OK

    and waits for an (eventual) rendezvous with the mobile client.
(If an error occurs, the rendezvous server returns a 4xx or 5xx response and closes the connection.)

    Similarly,
the hidden server, upon receiving the 200 response,
waits for a subsequent HTTP request from the mobile client over the connection.
In the interim,
if the connection fails,
the hidden server retries accordingly.

4. The mobile client establishes an HTTPS connection to the rendezvous server, e.g.,

        https://rendezvous.example.com/...

    and gets back a request for digest authentication from the rendezvous server:

        HTTP/1.1 401
        WWW-Authenticate: Digest realm="rendezvous"
                          , qop="auth, auth-int"
                          , nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093"
                          , opaque="5ccc069c403ebaf9f0171e9517f40e41"

    and the mobile client responds using the hidden server's UUID as the username with any password:

        GET /... HTTP/1.1
        Host: ...
        Connection: keep-alive
        Authorization: Digest username="ID"
                       , realm="rendezvous"
                       , qop=auth
                       , nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093"
                       , opaque="5ccc069c403ebaf9f0171e9517f40e41"
                       , ...

    (Yes, the HTTP-specific protocol misuses HTTP's
[digest authentication](http://en.wikipedia.org/wiki/Digest_authentication) header to identify the hidden server.)

5. If a hidden server with that identity is registered,
then the rendezvous server sends the mobile client's second HTTP request over the connection to the hidden server,
but without the 'Authentication' header.
(Otherwise, the rendezvous server returns a 4xx or 5xx response and closes the connection.)

6. Upon receiving the HTTP request,
in addition to processing any data on the connection,
the hidden server may make another HTTPS connection to the rendezvous server.
(In this fashion,
the hidden server should always have something waiting for the next mobile client connection.)

7. Regardless:

 * any data written from one socket is written to the other; and,

 * if either socket is closed, the other socket is also closed.

Pictorially:

                                rendezvous  server
                                +----------------+
                                |                |
                                | 1:listen on    |
                                | well-known IP  |
                                | adddress and   |
     "hidden" server            | TCP port       |
     behind NAT, etc.           |                |
    +----------------+          |                |
    |                |          |                |
    |2:HTTPS CONNECT |   ---->  |                |
    |                |          |                |
    |                |  <----   | 3:return 200   |
    |                |          |                |
    |  keep TCP open |          | keep TCP open  |            mobile  client
    |                |          |                |          +----------------+
    |                |          |                |          |                |
    |                |          |                |          | 4:HTTPS with   |
    |                |          |                |  <----   |                |
    |                |          |                |          |                |
    |                |          | return 401     |   ---->  |                |
    |                |          |                |          |                |
    |                |          |                |          | HTTPS with     |
    |                |          |                |          | digest         |
    |                |          |                |  <----   | authentication |
    |                |          |                |          |                |
    |                |  <----   | 5:send request |          |                |
    |                |          |                |          |                |
    |                |          |                |          |                |
    | 6:             |          |                |          |                |
    | [if multiple   |          |                |          |                |
    |  connections   |          |                |          |                |
    |  are desired,  |          |                |          |                |
    |  another TCP   |          |                |          |                |
    |  connection to |          |                |          |                |
    |  the rendezvous|          |                |          |                |
    |  server occurs]|          |                |          |                |
    |                |          |                |          |                |
    |                |          |                |          |                |
    |       7:       |          |       7:       |          |       7:       |
    | send/recv data |  <---->  | <------------> |  <---->  | send/recv data |
    |    until close |          |                |          | until close    |
    |                |          |                |          |                |
    |                |  <----   | <------------  |  <----   | close          |
    |                |          |     and/or     |          |                |
    |          close |   ---->  |  ------------> |   ---->  |                |
    |                |          |                |          |                |
    +----------------+          +----------------+          +----------------+

Security Model
==============
The security model is:

1. The hidden server and the mobile client have to know the domain-name or IP-address of the rendezvous server,
and have to trust the certificate used by the rendezvous server.
This knowledge and trust is determined by out-of-band means.

2. The hidden server and rendezvous server must share a time-based secret.
This is how the rendezvous server knows that the hidden server is allowed to respond to requests for a particular UUID.
This shared secret is created by out-of-band means.

3. The mobile client does not need to authenticate itself to the rendezvous server.
If a hidden server is responding for a particular UUID,
then amy mobile client knowing the UUID is allowed to initiate a connection to that hidden server.

4. __Most importantly:__ it is the responsibility of the hidden server to authenticate the mobile client once the rendezvous
occurs.
Although there are many well-reasoned arguments as to why hiding behind a firewall is a bad thing,
please do not negate the one good thing about being behind a firewall or NAT!

VPS Set-Up
==========
You do not need to have a domain name for your VPS;
however, you must have a stable IP address (e.g., 'a.b.c.d').

1. Get a [tarball](https://github.com/mrose17/node-rendezvous/archive/master.zip) of this repostory onto your local system,
extract it, and then:

        % cd node-rendezvous-master
        % npm -l install

    Note that until we reach Step 7, all the commands will be run on your local system.

2. Create a file called:

        vps.js

    that looks like this:

        var fs          = require('fs')
          ;

        exports.options =
          { rendezvousHost : 'a.b.c.d'
          , rendezvousPort : 8899
        
          , keyData        : fs.readFileSync('./registrar.key')
          , crtData        : fs.readFileSync('./registrar.crt')
        
          , redisHost      : '127.0.0.1'
          , redisPort      : 6379
          , redisAuth      : ''
          };
    
3. Create a keypair for use by the rendezvous server:

        % node make-cert.js

        % chmod  a-w registrar.key registrar.crt

        % chmod go-r registrar.key

    to create a self-signed certificate:

        registrar.crt

    and the corresponding private key:

        registrar.key

4. We're nearly ready.
The next step is to create entries in the database for the hidden servers.
Running:

        % node users.js

    will bring up a server on:

        http://127.0.0.1:8893

    Browse this URL, and you will see all UUIDs defined in the database (initially, none).
To create an entry, use the form on the page.
Whenever an entry is created,
a JS file is created which you can use with your hidden server.
You will want to copy the JS file to the provisioning area for your hidden server.

5. When you are done creating entries for the remote servers, kill the node process running

        users.js

6. Copy the server files to the VPS:

        % rm -rf node_modules
        % cd .. ; scp -r node-rendezvous-master root@a.b.c.d:.

7. Login to the VPS and install [node.js](http://nodejs.org/download/), and then

        vps% cd node-rendezvous-master/
        vps% npm install -l
        vps% cp vps.js local.js

8. Finally, start the server:

        vps% bin/run.sh

    Log entries are written to the file:

        server.log

License
=======

[MIT](http://en.wikipedia.org/wiki/MIT_License) license. Freely have you received, freely give.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
