# Francine: Highly scalable renderer backend

Francine is a highly scalable task manager and scheduler. It is specially designed for ray tracing rendering tasks.

Older version that was written in Go and using Redis is [here](https://github.com/lighttransport/francine-old).

[![Build Status](https://travis-ci.org/lighttransport/francine.svg?branch=master)](https://travis-ci.org/lighttransport/francine)

## Usage

### Test locally

    gcc -o ao ao.c lodepng.c
    npm install
    node lib/main --mode=master --test
    curl http://localhost:3000/

### Deploy to Google Compute Engine

Make sure you have installed the latest [Google Cloud SDK](https://cloud.google.com/sdk/).

    npm install
    node lib/main --mode=deploy --instanceType=gce --startMaster
    curl http://your.gce.insatnce:3000/

To stop the cluster, run

    node lib/main --mode=deploy --instanceType=gce --teardown

## API design

There are sessions. Sessions are associated to each user. Sessions can have associated resources. The resources once associated to the session are immutable. The resources can be retrieved from cloud storages e.g. Google Drive and Dropbox. They are spread to workers efficiently.

Sessions can have their executions. Each execution can patch the sessions. The detail of the patching differs between producers.

The executions are transparently divided into tasks. There are two types of tasks: productions and reductions. A producer is a renderer. A reducer is a synthesizer that makes an image from many images.

The users of Francine API can directly create sessions and executions but cannot control tasks.

## Architecture design

There are two type of instances: master and workers. All the tasks are scheduled by the master. The master is a [SPOF](http://en.wikipedia.org/wiki/Single_point_of_failure).

Master continually pings the workers through JSON RPC port. The workers pong the master while piggy-backing their logs and session cache information.

The master logs every request and continually makes its state snapshot, so it can tolerate unexpected restarts (not implemented).

Workers have no such tolerances and the failures are managed through rescheduling by the master.

When a session is registered, the registration is validated (not implemented) and authenticated by the master. If successful, it will be saved to master but nothing will happen immediately.

If an execution is registered, the master break down it to multiple producing tasks and reducing tasks. The master assigns tasks to the workers while minimizing resource transferring cost.

The workers can respond to resource and result transferring request through HTTP.

Every time each worker finishes its long task, finish RPC call will be sent to the master.

## Coding style guide

The project will use [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript).

## TODOs

* Write auto-scaling policy
* Write scheduling policy
* Write error handling and fault tolerant scheduling
* Support session associated external file API
* Support dedicated resource file storage
* Support REST API authentication
* Support advanced logging
* Test in 10k nodes environment and improve scalability
* Support LTE renderer as a producer
* Support EXR file format as a reducer
* Improve REST API
* Support other API interfaces (e.g. WebSocket)
* Support Amazon EC2 as an instance type
* Support request snapshotting

## References

* [Dean, J., & Ghemawat, S. (2008). MapReduce: simplified data processing on large clusters. Communications of the ACM, 51(1), 107-113.](http://static.googleusercontent.com/media/research.google.com/ja/us/archive/mapreduce-osdi04.pdf)
* [Isard, M., Prabhakaran, V., Currey, J., Wieder, U., Talwar, K., & Goldberg, A. (2009, October). Quincy: fair scheduling for distributed computing clusters. In Proceedings of the ACM SIGOPS 22nd symposium on Operating systems principles (pp. 261-276). ACM.](http://research.microsoft.com/apps/pubs/default.aspx?id=81516)
* [Schwarzkopf, M., Konwinski, A., Abd-El-Malek, M., & Wilkes, J. (2013, April). Omega: flexible, scalable schedulers for large compute clusters. In Proceedings of the 8th ACM European Conference on Computer Systems (pp. 351-364). ACM.](http://eurosys2013.tudos.org/wp-content/uploads/2013/paper/Schwarzkopf.pdf)

