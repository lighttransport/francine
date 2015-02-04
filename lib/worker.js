'use strict';

var jsonrpc = require('multitransport-jsonrpc');
var fs = require('fs');
var exec = require('child_process').exec;

var JsonRpcServer = jsonrpc.server;
var JsonRpcServerTcp = jsonrpc.transports.server.tcp;

var Worker = function (argv) {
    var self = this;

    self.port = argv.port || 5000;

    self.server = null;
};

// This is synchronous method.
Worker.prototype.start = function () {
    var self = this;

    console.log('Waiting on port ' + self.port + ' for JSON RPC request...');

    self.server = new JsonRpcServer(new JsonRpcServerTcp(self.port), {
        stop: function (callback) {
            console.log('Stopping worker by request...');
            process.exit(0);

            // It will never be called.
            callback(null, {});
        },

        ping: function (callback) {
            // TODO(peryaudo): piggy back console messages and counters
            callback(null, {});
        },

        reduce: function (taskName, workers, callback) {
            // TODO(peryaudo): implement
            callback(null, {});
        },

        produce: function (taskName, callback) {
            exec('./ao', function (error, stdout, stderr) {
                console.log(stdout);
                console.log(stderr);
                // TODO(peryaudo): error handling
                if (error) {
                    console.log(error);
                    return;
                }
                fs.readFile('./ao.ppm', function (error, image) {
                    // TODO(peryaudo): error handling
                    if (error) {
                        console.log(error);
                        return;
                    }
                    // TODO(peryaido): This return value is not proper because it violates general design.
                    callback(null, {
                        taskName: taskName,
                        image: image.toString('base64'),
                        count: 1
                    });
                });
            });
        },
    });
};

module.exports = Worker;
