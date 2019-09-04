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
  const port = typeof address !== 'string'
    ? address!.port || -1
    : -1

  log(`Server started at port ${port} :)`)
})

const proxy = new ProxyServer(wss)
const httpserver = new HttpServer(app, proxy)

const shutdown = async () => {
  return new Promise((resolve, reject) => {
    server.on('close', () => {
      resolve()
    })
    server.on('error', e => {
      reject(e)
    })
    server.close()
  })
}

export {
  shutdown
}
