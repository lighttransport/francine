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

## TODOs

* Write auto-scaling policy
* Write scheduling policy
* Write error handling and fault tolerant scheduling
* Support session associated external file API
* Support dedicated resource file storage
* Support REST API authentication
* Support logging
* Test in 10k nodes environment and improve scalability
* Support LTE renderer as a producer
* Support EXR file format as a reducer
* Improve REST API
* Support other API interfaces (e.g. WebSocket)

## References

* [Dean, J., & Ghemawat, S. (2008). MapReduce: simplified data processing on large clusters. Communications of the ACM, 51(1), 107-113.](http://static.googleusercontent.com/media/research.google.com/ja/us/archive/mapreduce-osdi04.pdf)
* [Isard, M., Prabhakaran, V., Currey, J., Wieder, U., Talwar, K., & Goldberg, A. (2009, October). Quincy: fair scheduling for distributed computing clusters. In Proceedings of the ACM SIGOPS 22nd symposium on Operating systems principles (pp. 261-276). ACM.](http://research.microsoft.com/apps/pubs/default.aspx?id=81516)
* [Schwarzkopf, M., Konwinski, A., Abd-El-Malek, M., & Wilkes, J. (2013, April). Omega: flexible, scalable schedulers for large compute clusters. In Proceedings of the 8th ACM European Conference on Computer Systems (pp. 351-364). ACM.](http://eurosys2013.tudos.org/wp-content/uploads/2013/paper/Schwarzkopf.pdf)

