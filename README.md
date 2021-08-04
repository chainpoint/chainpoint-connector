# Chainpoint Connector

Chainpoint Connector is an easy way to manage retrieval of proofs from the Chainpoint Network. 
Because proof submission and retrieval from the blockchain is a highly asynchronous process, 
Connector is designed to queue up and execute callbacks when proofs become available. 

## Installation

`npm install chainpoint-connector --save-prod`

or, if you want the latest fixes,

`npm install https://github.com/chainpoint/chainpoint-connector --save-prod`

## Usage

Connector uses redis as a persistent datastore. After connecting with redis and 
setting up the task scheduler, you can define a custom callback method to accept and store
the proof results when they arrive. The callback is passed the following parameters: 

- any upstream `error`
- `time` (ms)
- an optional `id` that can be added to allow your system to identify a proof when retrieved
- the `type` of proof (cal or btc, standing for calendar or bitcoin anchor)
- the proof returned by the Chainpoint Network

Example:
```javascript
import ChainpointConnector from 'chainpoint-connector'


async function submitAndMonitor() {
    const chpconn = new ChainpointConnector("redis", 6379)
    await chpconn.connect()
    chpconn.setCallback(async function (error, time, id, type, proofs) {
        if (!error && type == "btc") {
            console.log(proofs)
            //update your database with results
        }
    })
    let hashes = [
        '1d2a9e92b561440e8d27a21eed114f7018105db00262af7d7087f7dea9986b0a',
        '2d2a9e92b561440e8d27a21eed114f7018105db00262af7d7087f7dea9986b0a',
        '3d2a9e92b561440e8d27a21eed114f7018105db00262af7d7087f7dea9986b0a'
    ]
    await chpconn.submitHashes('custom ID', hashes)
}

submitAndMonitor()

```