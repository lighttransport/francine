## Install

    curl -fsSL https://goo.gl/getgrpc | bash -
    brew install gflags
    brew install glog

## Try

    ./francine --worker_address=0.0.0.0:50052
    ./francine --worker_address=0.0.0.0:50053
    ./francine --worker_address=0.0.0.0:50054
    ./francine --master --workers_list=localhost:50052,localhost:50053,localhost:50054
    ./test > /tmp/ao.png && open /tmp/ao.png
