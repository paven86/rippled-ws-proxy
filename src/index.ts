import Debug from 'debug'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import * as http from 'http'
import WebSocket from 'ws'
import {ProxyServer, HttpServer} from './handler'

if (typeof process.env.JEST_WORKER_ID === 'undefined') {
  process.stdout.write(`\u001b[2J\u001b[0;0H`)
  process.stdout.write(`<<< rippled-ws-proxy >>>\n\n`)
}

const log = Debug('app')

/**
 * WS server
 */
const app = express()
app.use(helmet({
  frameguard: {
    action: 'allow-from',
    domain: '*'
  }
}))
app.use(cors())

const server = http.createServer(app)
const wss = new WebSocket.Server({server})

server.listen(process.env.PORT || 80, () => {
  const address = server.address()
  const port = typeof address !== 'string' ? address!.port || -1 : -1
  log(`WS server started at port ${port}`)
})

/**
 * Admin server
 */

const adminApp = express()
const adminServer = http.createServer(adminApp)
adminServer.listen(Number(process.env.PORT || 80) + 1, () => {
  const address = adminServer.address()
  const port = typeof address !== 'string' ? address!.port || -1 : -1
  log(`ADMIN server started at port ${port}`)
})

/**
 * Run proxy and Admin server
 */

const proxy = new ProxyServer(wss)
const admin = new HttpServer(adminApp, proxy)

/**
 * Remaining stuff
 */

const shutdown = async () => {
  return new Promise((resolve, reject) => {
    server.on('close', () => resolve())
    server.on('error', e => reject(e))
    server.close()

    adminServer.on('close', () => resolve())
    adminServer.on('error', e => reject(e))
    adminServer.close()
  })
}

export {
  shutdown
}
