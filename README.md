# Francine: Highly scalable renderer backend

Francine is a highly scalable job manager and scheduler. It is specially designed for distributed ray tracing tasks.

Older version that was written in Go and using Redis is [here](https://github.com/lighttransport/francine-old).

[![Build Status](https://travis-ci.org/lighttransport/francine.svg?branch=master)](https://travis-ci.org/lighttransport/francine)
[![Dependency Status](https://david-dm.org/lighttransport/francine.svg)](https://david-dm.org/lighttransport/francine)
[![Code Climate](https://codeclimate.com/github/lighttransport/francine/badges/gpa.svg)](https://codeclimate.com/github/lighttransport/francine)

## Usage

Write a configuration file at ~/.francinerc:

    {
        "gce": {
            "project": "(Google Compute Engine project name)",
            "zone": "us-central1-a",
            "masterMachineType": "n1-highcpu-2",
            "workerMachineType": "n1-highcpu-4"
        },
        "dropbox": {
            "apiKey": "(Dropbox API key)",
            "apiSecret": "(Dropbox API secret)"
        },
        "ltePath": "/path/to/lte/lte_Linux_x64",
        "malliePath": "/path/to/mallie",
        "staticInstanceSize": 256
    }

The files under ltePath and malliePath are automatically forwarded to the cluster.

Mallie can be obtained from [here](https://github.com/lighttransport/mallie).

### Test locally

    ./run_locally.sh
    curl http://localhost:3000/

### Deploy to Google Compute Engine

Make sure you have installed the latest [Google Cloud SDK](https://cloud.google.com/sdk/) and written ~/.francinerc.

    ./deploy.sh
    curl http://your.master.gce.instance:3000/

To stop the cluster, run

    ./teardown.sh

You can see the web dashboard on

    http://your.master.gce.instance:4000/

## API design

There are sessions. The sessions are associated to each user. The sessions can have associated resources. The resources once associated to the session are immutable. The resources can be retrieved from cloud storages e.g. Google Drive and Dropbox. They are spread to workers efficiently.

The sessions can have their executions. Each execution can patch the sessions. The detail of the patching differs between producers.

The executions are transparently divided into tasks. There are two types of tasks: productions and reductions. A producer is a renderer. A reducer is a synthesizer that makes an image from many images.

The users of Francine API can directly create sessions and executions but cannot control tasks.

## Architecture design

There are two type of instances: master and workers. All the tasks are scheduled by the master. The master is a [SPOF](http://en.wikipedia.org/wiki/Single_point_of_failure).

Master continually pings the workers through JSON RPC port. The workers pong the master while piggy-backing their logs and session cache information.

The master logs every request and continually makes its state snapshot, so it can tolerate unexpected restarts (not implemented).

The workers have no such tolerances and the failures are managed through rescheduling by the master.

When a session is registered, the registration is validated (not implemented) and authenticated by the master. If successful, it will be saved to master but nothing will happen immediately.

If an execution is registered, the master break down it to multiple producing tasks and reducing tasks. The master assigns tasks to the workers while minimizing resource transferring cost.

The workers can respond to resource and result transferring request through HTTP.

Every time each worker finishes its long task, finish RPC call will be sent to the master.

## REST API

* Session
  * POST /sessions
  * GET /sessions/:sessionName
  * DELETE /sessions/:sessionName
* Execution
  * POST /sessions/:sessionName/executions
  * GET /sessions/:sessionName/executions/:executionName
  * GET /sessions/:sessionName/executions/:executionName/result

## Coding style guide

The project will use [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript).

## TODOs

* Make external OAuth storages compatible with francine REST APIs
* Write benchmark
* Support advanced logging
* Support LTE process caching
* Support Google Drive as file storage
* Write demo

* Write auto-scaling policy
* Write scheduling policy
* Write error handling and fault tolerant scheduling
* Support dedicated resource file storage
* Support REST API authentication
* Test in 10k nodes environment and improve scalability
* Support EXR file format as a reducer
* Improve REST API
* Support other API interfaces (e.g. WebSocket)
* Support Amazon EC2 as an instance type
* Support request snapshotting
* Use ES6 Promise instead of Q

## References

* [Dean, J., & Ghemawat, S. (2008). MapReduce: simplified data processing on large clusters. Communications of the ACM, 51(1), 107-113.](http://static.googleusercontent.com/media/research.google.com/ja/us/archive/mapreduce-osdi04.pdf)
* [Isard, M., Prabhakaran, V., Currey, J., Wieder, U., Talwar, K., & Goldberg, A. (2009, October). Quincy: fair scheduling for distributed computing clusters. In Proceedings of the ACM SIGOPS 22nd symposium on Operating systems principles (pp. 261-276). ACM.](http://research.microsoft.com/apps/pubs/default.aspx?id=81516)
* [Schwarzkopf, M., Konwinski, A., Abd-El-Malek, M., & Wilkes, J. (2013, April). Omega: flexible, scalable schedulers for large compute clusters. In Proceedings of the 8th ACM European Conference on Computer Systems (pp. 351-364). ACM.](http://eurosys2013.tudos.org/wp-content/uploads/2013/paper/Schwarzkopf.pdf)

