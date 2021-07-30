import { Worker, Plugins, Scheduler, Queue } from "node-resque";
import chainpoint from 'chainpoint-js'
import chpParse from 'chainpoint-parse'
import url from 'url';

export default class ChainpointConnector {

    constructor(redisUri, redisPassword, calWait=140000, btcWait=5400000) {
        const redisUrl = url.parse(redisUri)
        this.connectionDetails = {
            pkg: "ioredis",
            host: redisUrl.host,
            password: redisPassword,
            port: redisUrl.port,
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
                perform: async (time, id, proofHandle, callback) => {
                    let proof
                    try {
                        proof = await chainpoint.getProofs(proofHandles)
                        if (proof.length == 1) {
                            let result = chpParse.parse(proof[0])
                            let strResult = JSON.stringify(result)
                            if (!strResult.includes('cal_anchor_branch')){
                                await queue.enqueueIn(this.calendarWaitTime, "chp", "calJob", [time, id, proofHandle, cb]);
                            } else {
                                callback(null, time, id, proof)
                            }
                        }
                        if (time - Date.parse(result.hash_received) > this.hourMs) {
                            throw 'timed out attempting to retrieve calendar proof'
                        }
                    } catch(error){
                        callback(error, time, id, null)
                        console.log(`error: ${error.message}`)
                    }
                },
            },
            getBtcProof: {
                plugins: [Plugins.JobLock],
                pluginOptions: {
                    JobLock: {reEnqueue: true},
                },
                perform: async (time, id, proofHandle, callback) => {
                    let proof
                    try {
                        proof = await chainpoint.getProofs(proofHandles)
                        if (proof.length == 1) {
                            let result = chpParse.parse(proof[0])
                            let strResult = JSON.stringify(result)
                            if (!strResult.includes('btc_anchor_branch')){
                                await queue.enqueueIn(this.btcWaitTime, "chp", "btcJob", [time, id, proofHandle, cb]);
                            } else {
                                callback(null, time, id, proofs)
                            }
                        }
                        if (time - Date.parse(result.hash_received) > this.dayMs) {
                            throw 'timed out attempting to retrieve btc proof'
                        }
                    } catch(error){
                        callback(error, time, id, null)
                        console.log(`error: ${error.message}`)
                    }
                },
            },
        }
        this.worker = new Worker(
            { connection: this.connectionDetails, queues: ["chp"] },
            this.jobs
        );
        this.worker.connect();
        this.worker.start();
        this.scheduler = new Scheduler({ connection: this.connectionDetails });
        await this.scheduler.connect();
        this.scheduler.start();
        this.queue = new Queue({ connection: this.connectionDetails }, this.jobs);
        await this.queue.connect()
    }

    async submitHashes(hashesObj, cb) {

    }

    async submitHash(id, hash, cb) {
        let proofHandle
        try{
           proofHandle = await chainpoint.submitHashes([hash])
        } catch (error) {
           cb(error, Date.now(), id, null)
        }
        await queue.enqueueIn(this.calendarWaitTime, "chp", "calJob", [Date.now(), id, proofHandle, cb]);
        await queue.enqueueIn(this.btcWaitTime, "chp", "btcJob", [Date.now(), id, proofHandle, cb]);
    }
}
