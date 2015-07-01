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
            "workerMachineType": "n1-highcpu-4",
            "isPreemptive": true,
            "prefix": "instance-name-prefix"
        },
        "dropbox": {
            "apiKey": "(Dropbox API key)",
            "apiSecret": "(Dropbox API secret)"
        },
        "users": {
            "yourusernameforfrancine": "yourpasswordforfrancine"
        },

        "privateKey": "(private key for auth token francine issues)",

        "ltePath": "/path/to/lte/lte_Linux_x64",
        "malliePath": "/path/to/mallie",

        "restPort": 3000,
        "wsPort": 3001,

        "instanceManagerType": "(static and twostate are supported)",
        "staticInstanceSize": 256,
        "manageInterval": 60,

        "disableZombieDestroy": false,
        "chaos": 10
    }

The files under ltePath and malliePath are automatically forwarded to the cluster.

Both ltePath and malliePath are optional.

Set isPreemptive option true to use [preemptive instances](http://googlecloudplatform.blogspot.jp/2015/05/Introducing-Preemptible-VMs-a-new-class-of-compute-available-at-70-off-standard-pricing.html) for workers in Google Compute Engine.

Mallie can be obtained from [here](https://github.com/lighttransport/mallie).

restPort is TCP port that francine master uses for REST API.

wsPort is TCP port that francine master uses for WebSocket API.

instanceManagerType is type of instance management policy for the cluster. Currently, static(keep staticInstanceSize) and twostate(keep 1 or staticInstanceSize based on the usage of the last 10 minutes) are available.

manageInterval is an interval that francine does instance management.

disableZombieDestroy disables automatic destruction of zombie instances. It is generally for debugging.

chaos is percentile that each worker instance randomly fails. It is inspired by Netflix's Chaos Monkey. 

### Test locally

    ./run_locally.sh
    curl http://localhost:3000/

### Deploy to Google Compute Engine

Make sure you have installed the latest [Google Cloud SDK](https://cloud.google.com/sdk/) and written ~/.francinerc.

    ./deploy.sh
    curl http://your.master.gce.instance:3000/?parallel=16

To stop the cluster, run

    ./teardown.sh

You can see the web dashboard on

    http://your.master.gce.instance:4000/

## REST API / WebSocket API

There are sessions. The sessions are associated to each user. The sessions can have associated resources. The resources once associated to the session are immutable. The resources can be retrieved from cloud storages e.g. Google Drive and Dropbox. They are spread to workers efficiently.

The sessions can have their executions. Each execution can update the session. The details of the updating options depend on producers.

The executions are transparently divided into tasks. There are two types of tasks: productions and reductions. A producer is a renderer. A reducer is a synthesizer that makes an image from many images.

The users of Francine API can directly create sessions and executions but cannot control tasks.

### WebSocket specific fields

Outputs through WebSocket have WebSocket specific fields.

    {
        "command": "(name of the command)",
        "responseId": "(response ID)"
    }

command is the command name that emits the response.

responseId is the number that you specified in the responseId field of the request (optional).

### Authentication

#### authenticate (POST /auth)

(REST)
Get API token for francine. You should specify the given token using X-API-Token header to corresponding API calls.

(WebSocket) Authenticate for the WebSocket connection. All commands that will be sent through the connection will be authenticated.

Input(REST):

    {
        "userName": "yourusernameforfrancine",
        "password": "yourpasswordforfrancine"
    }

Input(WebSocket):

    {
        "command": "authenticate",
        ("responseId": number),
        "userName": "yourusernameforfrancine",
        "password": "yourpasswordforfrancine"
    }

Output(Success):

    {
        (WebSocket specific fields)
        "authToken": "yourapitoken"
    }

Output(Failure):

    {
        (WebSocket specific fields)
        "error": "(reason)"
    }

#### getAuthorizeStatus (GET /auth/:resourceName)

Get OAuth status for each resource provider. Currently only supports resourceName = dropbox.

Input(WebSocket):

    {
        "command": "getAuthorizeStatus",
        ("responseId": number),
        "resourceName": "dropbox"
    }

Output:

    {
        (WebSocket specific fields)
        "authorizeUrl": "https://urlforoauth",
        "authorized": boolean
    }


#### registerResourceToken (POST /auth/:resourceName)

Associate the authorized resource provider to the francine account.

Input(REST):

    {
        "code": "(OAuth authorization code given by the resource provider)"
    }

Input(WebSocket):

    {
        "command": "registerResourceToken",
        ("responseId": number),
        "resourceName": "dropbox",
        "code": "(OAuth authorization code given by the resource provider)"
    }


Output(Success):

    {
        (WebSocket specific fields)
        "success": true
    }

Output(Failure):

    {
        (WebSocket specific fields)
        "error": "(reason)"
    }

### Session

#### createSession (POST /sessions)

Create a session.

Input:

    {
        "command": "createSession", (if WebSocket)
        ("responseId": number),

        "producer": "ao" | "mallie" | "lte",
        "format": "png" | "jpg" | "exr",
        "resources": [
            {
                "type": "dropbox",
                "path": "/path/to/the/file/in/dropbox",
                "dst": "file_name_to_be_placed"
            },
            ...
        ]
    }

Output:

If ?block=true is specified, it will return the resulting image file in binary.
Otherwise, it will return the session information (see getSession).
   

#### getSession (GET /sessions/:sessionName)

Get the session information.

Input(WebSocket):

    {
        "command": "getSession",
        ("responseId": number),

        "sessionName": ":sessionName"
    }

#### deleteSession (DELETE /sessions/:sessionName)

Delete the session and the associated executions.

Input(WebSocket):

    {
        "command": "deleteSession",
        ("responseId": number),

        "sessionName": ":sessionName"
    }

### Execution

#### createExecution (POST /sessions/:sessionName/executions [?block=true])

Create an execution.

Input(REST):

    {
        "parallel": 8 // Number of parallelized tasks
        "update": {} // Update data (depend on producer types)
    }

Output:

If block=true is specified, it will return rendered image directly.

If not specified, it will immediately return execution information and start rendering asynchronously (see getExecution).

Input(WebSocket):

    {
        "command": "createExecution",
        ("responseId": number),

        "parallel": 8 // Number of parallelized tasks
        "update": {} // Update data (depend on producer types)
    }

The contents of the updates will be applied to all the following executions.

Output(WebSocket):

    {
        (WebSocket specific fields)
        "format": "png" | "jpg" | "exr",
        "image": "(rendered image file in base64 form)"
    }

The format of the returned data is subject to change.

#### getExecution (GET /sessions/:sessionName/executions/:executionName)

Get the execution information.

Input(WebSocket):

    {
        "command": "getExecution",
        ("responseId": number),

        "executionName": ":executionName"
    }

Output:

The format of the returned data is subject to change.

You cannot delete an execution alone. If you want to delete and execution, you have to delete the whole associated session.

#### getExecutionResult (GET /sessions/:sessionName/executions/:executionName/result)

Get the resulting image of the execution.

Input(WebSocket):

    {
        "command": "getExecutionResult",
        ("responseId": number),

        "executionName": ":executionName"
    }

Output(REST):

resulting image file in binary

Output(WebSocket):

    {
        (WebSocket specific fields)
        "format": "png" | "jpg" | "exr",
        "image": "(rendered image file in base64 form)"
    }

The format of the returned data is subject to change.

## Architecture design

There are two type of instances: master and workers. All the tasks are scheduled by the master. The master is a [SPOF](http://en.wikipedia.org/wiki/Single_point_of_failure).

Master continually pings the workers through JSON RPC port. The workers pong the master while piggy-backing their logs and session cache information.

The master logs every request and continually makes its state snapshot, so it can tolerate unexpected restarts (not implemented).

The workers have no such tolerances and the failures are managed through rescheduling by the master.

When a session is registered, the registration is validated (not implemented) and authenticated by the master. If successful, it will be saved to master but nothing will happen immediately.

If an execution is registered, the master break down it to multiple producing tasks and reducing tasks. The master assigns tasks to the workers while minimizing resource transferring cost.

The workers can respond to resource and result transferring request through HTTP.

Every time each worker finishes its long task, finish RPC call will be sent to the master.


## Coding style guide

The project will use [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript).

## TODOs

* [ ] Support advanced logging
* [ ] Support Google Drive as file storage
* [ ] Write advanced auto-scaling policy
* [ ] Write scheduling policy
* [ ] Support dedicated resource file storage
* [ ] Test in 10k nodes environment and improve scalability
* [ ] Support Amazon EC2 as an instance type
* [ ] Support request snapshotting
* [ ] Use ES6 Promise instead of Q
* [ ] Remove NAT gateway in the master instance (Distribute resource fetching to some workers with global IPs)
  * All the traffic passes through the master instance in the current implementation, so it might lead to scalability problem.

## References

* [Dean, J., & Ghemawat, S. (2008). MapReduce: simplified data processing on large clusters. Communications of the ACM, 51(1), 107-113.](http://static.googleusercontent.com/media/research.google.com/ja/us/archive/mapreduce-osdi04.pdf)
* [Isard, M., Prabhakaran, V., Currey, J., Wieder, U., Talwar, K., & Goldberg, A. (2009, October). Quincy: fair scheduling for distributed computing clusters. In Proceedings of the ACM SIGOPS 22nd symposium on Operating systems principles (pp. 261-276). ACM.](http://research.microsoft.com/apps/pubs/default.aspx?id=81516)
* [Schwarzkopf, M., Konwinski, A., Abd-El-Malek, M., & Wilkes, J. (2013, April). Omega: flexible, scalable schedulers for large compute clusters. In Proceedings of the 8th ACM European Conference on Computer Systems (pp. 351-364). ACM.](http://eurosys2013.tudos.org/wp-content/uploads/2013/paper/Schwarzkopf.pdf)

