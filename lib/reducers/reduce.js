'use strict';

var fs = require('fs');
var request = require('request');
var blend = require('blend');
var jsonrpc = require('multitransport-jsonrpc');

var JsonRpcClient = jsonrpc.client;
var JsonRpcClientTcp = jsonrpc.transports.client.tcp;

var reduceAndReturn = function (images, task, worker) {
    blend(images, function (error, result) {
        if (error) {
            worker.log('reduce', error);
            return;
        }

        fs.writeFile(worker.getTemporaryDirectory() + '/results/' + task.name, result, function (error) {
            if (error) {
                worker.log('reduce', error);
                return;
            }

            var master = worker.getMaster();

            new JsonRpcClient(new JsonRpcClientTcp(master.host, master.port), {}, function (client) {
                client.finish({
                    type: 'TASK',
                    workerName: worker.getName(),
                    task: task
                }, function () {});
            });
        });
    });
};

module.exports = function (task, worker) {
    var sources = task.execution.tasks;

    var remain = sources.length;

    var images = [];

    worker.log('reduce',
            'Reducing tasks of [' +
            sources.map(function (source) { return source.taskName; }).join(',') +
            ']');

    sources.map(function (source) {
        worker.log('reduce', 'Send result request of ' + source.taskName);

        var uri = 'http://' + source.worker.host + ':' + source.worker.resourcePort + '/results/' + source.taskName;
        worker.log('reduce', 'Uri: ' + uri);

        request({
            uri: uri,
            encoding: null
        }, function (error, response, body) {
            worker.log('reduce', 'Received result request of ' + source.taskName);

            images.push(body);

            --remain;
            if (remain <= 0) {
                reduceAndReturn(images, task, worker);
            }
        });
    });
};
