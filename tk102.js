/*
Name:         tk102
Description:  TK102 GPS server for Node.js
Author:       Franklin van de Meent (https://frankl.in)
Source:       https://github.com/fvdm/nodejs-tk102
Feedback:     https://github.com/fvdm/nodejs-tk102/issues
License:      Unlicense / Public Domain (see UNLICENSE file)
              (https://github.com/fvdm/nodejs-tk102/raw/master/UNLICENSE)
*/

var net = require ('net');
var EventEmitter = require ('events') .EventEmitter;
var tk102 = new EventEmitter ();

// device data
var specs = [
  function (raw) {
    // 1203292316,0031698765432,GPRMC,211657.000,A,5213.0247,N,00516.7757,E,0.00,273.30,290312,,,A*62,F,imei:123456789012345,123
    var result = null;
    var str = [];
    var datetime = '';
    var gpsdate = '';
    var gpstime = '';

    try {
      raw = raw.trim ();
      str = raw.split (',');

      if (str.length === 18 && str [2] === 'GPRMC') {
        datetime = str [0] .replace (/([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})/, function (s, y, m, d, h, i) {
          return '20' + y + '-' + m + '-' + d + ' ' + h + ':' + i;
        });

        gpsdate = str [11] .replace (/([0-9]{2})([0-9]{2})([0-9]{2})/, function (s, d, m, y) {
          return '20' + y + '-' + m + '-' + d;
        });

        gpstime = str [3] .replace (/([0-9]{2})([0-9]{2})([0-9]{2})\.([0-9]{3})/, function (s0, h, i, s, ms) {
          return h + ':' + i + ':' + s + '.' + ms;
        });

        result = {
          raw: raw,
          datetime: datetime,
          phone: str [1],
          gps: {
            date: gpsdate,
            time: gpstime,
            signal: str [15] === 'F' ? 'full' : 'low',
            fix: str [4] === 'A' ? 'active' : 'invalid'
          },
          geo: {
            latitude: tk102.fixGeo (str [5], str [6]),
            longitude: tk102.fixGeo (str [7], str [8]),
            bearing: parseInt (str [10], 10)
          },
          speed: {
            knots: Math.round (str [9] * 1000) / 1000,
            kmh: Math.round (str [9] * 1.852 * 1000) / 1000,
            mph: Math.round (str [9] * 1.151 * 1000) / 1000
          },
          imei: str [16] .replace ('imei:', ''),
          checksum: tk102.checksum (raw)
        };
      }
    } catch (e) {
      result = null;
    }

    return result;
  }
];

// defaults
tk102.settings = {
  ip: '0.0.0.0',
  port: 0,
  connections: 10,
  timeout: 10
};


// Catch uncaught exceptions (server kill)
process.on ('uncaughtException', function (err) {
  var error = new Error ('uncaught exception');

  error.error = err;
  console.trace (error);
});

// Create server
tk102.createServer = function (vars) {
  var key;

  // override settings
  if (typeof vars === 'object' && Object.keys (vars) .length >= 1) {
    for (key in vars) {
      tk102.settings [key] = vars [key];
    }
  }

  // start server
  tk102.server = net.createServer ();

  // maximum number of slots
  tk102.server.maxConnections = tk102.settings.connections;

  // server started
  tk102.server.on ('listening', function () {
    tk102.emit ('listening', tk102.server.address ());
  });

  // inbound connection
  tk102.server.on ('connection', function (socket) {
    var data = [];
    var size = 0;

    tk102.emit ('connection', socket);
    socket.setEncoding ('utf8');

    if (tk102.settings.timeout > 0) {
      socket.setTimeout (parseInt (tk102.settings.timeout * 1000, 10));
    }

    socket.on ('timeout', function () {
      tk102.emit ('timeout', socket);
      socket.destroy ();
    });

    socket.on ('data', function (ch) {
      tk102.emit ('data', ch);
      data.push (ch);
      size += ch.length;
    });

    socket.on ('close', function () {
      var gps = {};
      var err = null;

      data = Buffer.concat (data, size) .toString ('utf8');

      if (data !== '') {
        gps = tk102.parse (data);

        if (gps) {
          tk102.emit ('track', gps);
        } else {
          err = new Error ('Cannot parse GPS data from device');
          err.reason = err.message;
          err.socket = socket;
          err.input = data;

          tk102.emit ('fail', err);
        }
      }
    });

    // error
    socket.on ('error', function (error) {
      var err = new Error ('Socket error');

      err.reason = error.message;
      err.socket = socket;
      err.settings = tk102.settings;

      tk102.emit ('error', err);
    });
  });

  tk102.server.on ('error', function (error) {
    var err = new Error ('Server error');

    if (error === 'EADDRNOTAVAIL') {
      err = new Error ('IP or port not available');
    }

    err.reason = error.message;
    err.input = tk102.settings;

    tk102.emit ('error', err);
  });

  // Start listening
  tk102.server.listen (tk102.settings.port, tk102.settings.ip);
};

// Parse GPRMC string
tk102.parse = function (raw) {
  var data = null;
  var i = 0;

  while (data === null && i < specs.length) {
    data = specs [i] (raw);
    i++;
  }

  return data;
};

// Clean geo positions, with 6 decimals
tk102.fixGeo = function (one, two) {
  var minutes = one.substr (-7, 7);
  var degrees = parseInt (one.replace (minutes, ''), 10);

  one = degrees + (minutes / 60);
  one = parseFloat ((two === 'S' || two === 'W' ? '-' : '') + one);

  return Math.round (one * 1000000) / 1000000;
};

// Check checksum in raw string
tk102.checksum = function (raw) {
  var str = raw.trim () .split (/[,*#]/);
  var strsum = parseInt (str [15], 10);
  var strchk = str.slice (2, 15) .join (',');
  var check = 0;
  var i;

  for (i = 0; i < strchk.length; i++) {
    check ^= strchk.charCodeAt (i);
  }

  check = parseInt (check.toString (16), 10);
  return (check === strsum);
};

// ready
module.exports = tk102;
