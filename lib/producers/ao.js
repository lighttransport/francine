'use strict';

var spawn = require('child_process').spawn;
var jsonrpc = require('multitransport-jsonrpc');

var JsonRpcClient = jsonrpc.client;
var JsonRpcClientTcp = jsonrpc.transports.client.tcp;

var AoProducer = {};

AoProducer.produce = function (task, worker) {
    var output = worker.getTemporaryDirectory() + '/results/' + task.name;

    var spawned = spawn(__dirname + '/../../ao', [output]);
    spawned.stdout.on('data', function (data) {
        worker.log('AoProducer', data);
    });
    spawned.stderr.on('data', function (data) {
        worker.log('AoProducer', data);
    });
    spawned.on('close', function (code) {
        if (code !== 0) {
            worker.log('AoProducer', 'Returned with non-zero code: ' + code);
            return;
        }

        var master = worker.getMaster();
        // TODO(peryaudo): Should this be in worker class?
        new JsonRpcClient(new JsonRpcClientTcp(master.host, master.port), {}, function (client) {
            worker.log('Worker', 'Finish task ' + task.name + ' of ' + task.type + ' sent');
            client.finish({
                type: 'TASK',
                workerName: worker.getName(),
                task: task
            }, function () {});
        });
    });
};


module.exports = AoProducer;
