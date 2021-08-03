import { Worker, Plugins, Scheduler, Queue } from "node-resque";
import chainpoint from 'chainpoint-js'
import chpParse from 'chainpoint-parse'

export default class ChainpointConnector {

    constructor(redisHost="redis", redisPort=6379, redisPassword=null, calWait=140000, btcWait=5400000) {
        this.connectionDetails = {
            pkg: "ioredis",
            host: redisHost,
            password: redisPassword,
            port: redisPort,
            database: 0,
            namespace: 'chp-resque',
        }
        this.calendarWaitTime = calWait
        this.btcWaitTime = btcWait
        this.hourMs = 3600000
        this.dayMs = 86400000
    }

    async connect(){
        this.jobs = {
            getCalProof: {
                plugins: [Plugins.JobLock],
                pluginOptions: {
                    JobLock: {reEnqueue: true},
                },
                perform: async (time, id, proofHandles) => {
                    let proofs, result
                    let failed = false
                    try {
                        proofs = await chainpoint.getProofs(proofHandles)
                        proofs.forEach(proof => {
                            try {
                                console.log('proof ' + proof.proof)
                                result = chpParse.parse(proof.proof)
                                console.log('result ' + result)
                                let strResult = JSON.stringify(result)
                                console.log('strResult ' + strResult)
                                if (!strResult.includes('cal_anchor_branch')) {
                                    failed = true
                                }
                            } catch(error) {
                                console.log('proofs error: ' + JSON.stringify(error, ["message", "arguments", "type", "name"]));
                            }
                        })
                        if (failed) {
                            await this.queue.enqueueIn(this.calendarWaitTime, "chp", "getCalProof", [time, id, proofHandles]);
                        } else {
                            this.callback(null, time, id, proofs)
                            return
                        }
                        if (result.hasOwnProperty('hash_received') && time - Date.parse(result.hash_received) > this.hourMs) {
                            throw new Error('timed out attempting to retrieve cal proof')
                        }
                    } catch(error){
                        this.callback(error, time, id, proofs)
                        console.log('error: ' + JSON.stringify(error, ["message", "arguments", "type", "name"]));
                    }
                },
            },
            getBtcProof: {
                plugins: [Plugins.JobLock],
                pluginOptions: {
                    JobLock: {reEnqueue: true},
                },
                perform: async (time, id, proofHandles) => {
                    let proofs, result
                    let failed = false
                    try {
                        proofs = await chainpoint.getProofs(proofHandles)
                        proofs.forEach(proof => {
                            result = chpParse.parse(proof.proof)
                            let strResult = JSON.stringify(result)
                            if (!strResult.includes('btc_anchor_branch')){
                                failed = true
                            }
                        })
                        if (failed) {
                            await this.queue.enqueueIn(this.btcWaitTime, "chp", "getBtcProof", [time, id, proofHandles]);
                        } else {
                            this.callback(null, time, id, proofs)
                            return
                        }
                        if (result.hasOwnProperty('hash_received') && time - Date.parse(result.hash_received) > this.dayMs) {
                            throw new Error('timed out attempting to retrieve btc proof')
                        }
                    } catch(error){
                        this.callback(error, time, id, proofs)
                        console.log('error: ' + JSON.stringify(error, ["message", "arguments", "type", "name"]));
                    }
                },
            },
        }
        this.worker = new Worker(
            { connection: this.connectionDetails, queues: ["chp"] },
            this.jobs
        );
        await this.worker.connect();
        this.worker.start();
        this.scheduler = new Scheduler({ connection: this.connectionDetails });
        await this.scheduler.connect();
        this.scheduler.start();
        this.queue = new Queue({ connection: this.connectionDetails }, this.jobs);
        await this.queue.connect()
        this.worker.on("start", () => {
            console.log("worker started");
        });
        this.worker.on("end", () => {
            console.log("worker ended");
        });
        this.worker.on("cleaning_worker", (worker, pid) => {
            console.log(`cleaning old worker ${worker}`);
        });
        this.worker.on("poll", (queue) => {
            console.log(`worker polling ${queue}`);
        });
        this.worker.on("ping", (time) => {
            console.log(`worker check in @ ${time}`);
        });
        this.worker.on("job", (queue, job) => {
            console.log(`working job ${queue} ${JSON.stringify(job)}`);
        });
        this.worker.on("reEnqueue", (queue, job, plugin) => {
            console.log(`reEnqueue job (${plugin}) ${queue} ${JSON.stringify(job)}`);
        });
        this.worker.on("success", (queue, job, result, duration) => {
            console.log(
                `job success ${queue} ${JSON.stringify(job)} >> ${result} (${duration}ms)`
            );
        });
        this.worker.on("failure", (queue, job, failure, duration) => {
            console.log(
                `job failure ${queue} ${JSON.stringify(
                    job
                )} >> ${failure} (${duration}ms)`
            );
        });
        this.worker.on("error", (error, queue, job) => {
            console.log(`error ${queue} ${JSON.stringify(job)}  >> ${error}`);
        });
        this.worker.on("pause", () => {
            console.log("worker paused");
        });

        this.scheduler.on("start", () => {
            console.log("scheduler started");
        });
        this.scheduler.on("end", () => {
            console.log("scheduler ended");
        });
        this.scheduler.on("poll", () => {
            console.log("scheduler polling");
        });
        this.scheduler.on("leader", () => {
            console.log("scheduler became leader");
        });
        this.scheduler.on("error", (error) => {
            console.log(`scheduler error >> ${error}`);
        });
        this.scheduler.on("cleanStuckWorker", (workerName, errorPayload, delta) => {
            console.log(
                `failing ${workerName} (stuck for ${delta}s) and failing job ${errorPayload}`
            );
        });
        this.scheduler.on("workingTimestamp", (timestamp) => {
            console.log(`scheduler working timestamp ${timestamp}`);
        });
        this.scheduler.on("transferredJob", (timestamp, job) => {
            console.log(`scheduler enquing job ${timestamp} >> ${JSON.stringify(job)}`);
        });
    }

    setCallback(cb) {
        this.callback = cb
    }

    async submitHashes(id, hashes) {
        let proofHandles
        try{
           proofHandles = await chainpoint.submitHashes(hashes)
        } catch (error) {
           cb(error, Date.now(), id, null)
        }
        await this.queue.enqueueIn(this.calendarWaitTime, "chp", "getCalProof", [Date.now(), id, proofHandles]);
        await this.queue.enqueueIn(this.btcWaitTime, "chp", "getBtcProof", [Date.now(), id, proofHandles]);
    }
}
