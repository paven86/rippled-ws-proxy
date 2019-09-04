'use strict'

import crypto from 'crypto'
import Debug from 'debug'
import WebSocket from 'ws'
const log = Debug('app').extend('ProxyServer')
import * as remoteLogger from '../logging'
import {Request} from 'express'
import {UplinkClient} from './'
import {Client} from './types'
import io from '@pm2/io'

const metrics = {
  connections: io.counter({name: '∑ connections'}),
  clients: io.metric({name: '# clients'})
}

/**
 * TODO:
 *    REMOTE LOGGER
 *    UNLOCK FH SERVER
 *    SWITCH BACKEND
 *    DASHBOARD
 */

type UplinkServer = {
  type: string
  endpoint: string
  healthy: boolean
  errors: number // TODO: Register errors over time, if > X in recent time Y: healthy = false
  id?: string
}

/**
 * Todo: UplinkServers from config
 */

const UplinkServers: Array<UplinkServer> = [
  {type: 'fallback', endpoint: 'wss://s2.ripple.com/#fallback', healthy: true, errors: 0},
  // {type: 'basic', endpoint: 'wss://rippled-livenet.xrpl-labs.com/#basic', healthy: true, errors: 0},
  {type: 'basic', endpoint: 'wss://s2.ripple.com', healthy: true, errors: 0},
  // {type: 'priority', endpoint: 'wss://rippled-livenet.xrpl-labs.com/#priority', healthy: true, errors: 0},
  {type: 'priority', endpoint: 'wss://rippled.xrptipbot.com', healthy: true, errors: 0}
]

/**
 * TODO: soft-force all clients connected to a specific UplinkServer to
 * connect to a new backend server, eg. pre-maintenance.
 */

class ProxyServer {
  private WebSocketServer: any
  private Clients: Client[] = []

  constructor (wss: WebSocket.Server) {
    this.WebSocketServer = wss
    this.init()
  }

  getUplinkServers (): Array<UplinkServer> {
    return UplinkServers.map(s => {
      return Object.assign({}, {
        ...s,
        id: crypto.createHash('md5').update(s.endpoint).digest('hex')
      })
    })
  }

  updateUplinkServer (uplink: string, action: string): void {
    UplinkServers.filter(s => {
      return crypto.createHash('md5').update(s.endpoint).digest('hex') === uplink
    }).forEach(s => {
      log.extend('updateUplinkServer')(`Marking uplink [ ${s.endpoint} ] - ${action.toUpperCase()}`)
      if (action === 'migrate') {
        s.healthy = false
        const clientsToMigrate = this.getClients().filter(c => {
          return typeof c.uplink !== 'undefined'
            && typeof c.uplink.url === 'string'
            && c.uplink.url === s.endpoint
        })
        log.extend('MIGRATE')(`Migrating [ ${clientsToMigrate.length} clients ] away from ${s.endpoint}`)
        clientsToMigrate.forEach(c => {
          c.socket.emit('migrate')
        })
      }
      if (action === 'down') {
        s.healthy = false
      }
      if (action === 'up') {
        s.healthy = true
      }
    })
  }

  getClients (): Array<Client> {
    return this.Clients
  }

  getUplinkServer (clientState: Client): string {
    const possibleServers: string[] = UplinkServers.filter((r: any) => {
      return r.healthy === true && r.type === clientState.uplinkType.toLowerCase()
    }).map((r: any) => {
      return r.endpoint
    })

    if (possibleServers.length === 1) {
      return possibleServers[0]
    } else if (possibleServers.length > 1) {
      return possibleServers[Math.floor(Math.random() * possibleServers.length)]
    }

    // TODO: pooling?
    return 'wss://s2.ripple.com/#fallback'
  }

  connectUplink (clientState: Client): void {
    if (typeof clientState.uplink !== 'undefined') {
      if (clientState.uplink.url === clientState.preferredServer) {
        return
      }
    }
    if (!clientState.closed) {
      const newUplink = new UplinkClient(clientState, clientState.preferredServer)
      /**
       * 'gone' event only emits if NOT closed on purpose
       */
      newUplink.on('gone', () => {
        const thisUplink = UplinkServers.filter((r: any) => {
          return r.endpoint === newUplink.url
        })
        if (thisUplink.length === 1) {
          thisUplink[0].errors++
        }

        /**
         * Select new uplink server (RR)
         */
        clientState.preferredServer = this.getUplinkServer(clientState)
        log(`Uplink gone, retry in 2000ms to [ ${clientState.preferredServer} ]`)

        setTimeout(() => {
          clientState.uplink = undefined
          clientState.counters.uplinkReconnects++
          log(`Reconnecting...`)
          this.connectUplink(clientState)
        }, 2000)
        return
      })

      newUplink.on('open', () => {
        if (typeof clientState.uplinkMessageBuffer !== 'undefined' && clientState.uplinkMessageBuffer.length > 0) {
          log('Replaying buffered messages:', clientState.uplinkMessageBuffer.length)
          clientState.uplinkMessageBuffer.forEach(m => {
            newUplink.send(m)
          })
          clientState.uplinkMessageBuffer = []
        }

        newUplink.send(JSON.stringify({id: 'NEW_CONNECTION_TEST', command: 'ping'}))

        const killNewUplinkTimeout = setTimeout(() => {
          try {
            newUplink.close(0, 'ON_PURPOSE')
          } catch (e) {
            // Do nothing
          }
          log.extend('Uplink')(`!!! No incoming message within 5000ms from new uplink ${newUplink.url}, close`)
        }, 5000)

        newUplink.once('message', m => {
          log.extend('Uplink')(` >> Got first message from uplink. First health check OK.`)
          clearTimeout(killNewUplinkTimeout)

          if (clientState.uplinkCount === newUplink.getId()) {
            if (typeof clientState.uplink !== 'undefined') {
              log.extend('Uplink')(`Switch uplinks. ${clientState.uplink.url} disconnects, ${newUplink.url} connects`)
              clientState.uplink.close(0, 'ON_PURPOSE')
              clientState.uplink = undefined
            }

            // Uplink emits messages, switch the uplink
            clientState.uplink = newUplink
          } else {
            log.extend('Uplink')(`${newUplink.url} connected, but id expired`
              + ` (got ${newUplink.getId()}, is at ${clientState.uplinkCount}). Closing.`)
            try {
              newUplink.close(0, 'ON_PURPOSE')
            } catch (e) {
              // Do nothing
            }
          }
        })

        return
      })
    } else {
      log(`Not connecting: state != closed.`)
    }
  }

  init (): void {
    this.WebSocketServer.on('connection', (ws: WebSocket, req: Request) => {
      const clientState: Client = {
        closed: false,
        uplinkType: 'basic',
        preferredServer: '',
        socket: ws,
        request: req,
        uplinkMessageBuffer: [],
        uplinkSubscriptions: [],
        ip: String(req.headers['x-forwarded-for'] || req.connection.remoteAddress),
        connectMoment: new Date(),
        counters: {rxCount:0, txCount:0, rxSize:0, txSize: 0, uplinkReconnects: 0},
        uplinkCount: 0,
        headers: {
          'origin': String(req.headers['origin'] || ''),
          'userAgent': String(req.headers['user-agent'] || ''),
          'acceptLanguage': String(req.headers['accept-language'] || ''),
          'xForwardedFor': String(req.headers['x-forwarded-for'] || '')
        }
      }
      clientState.preferredServer = this.getUplinkServer(clientState)

      log(`New connection from [ ${clientState.ip} ], origin: [ ${clientState.headers.origin || ''} ]`)

      this.connectUplink(clientState)

      this.Clients.push(clientState)
      metrics.connections.inc()
      metrics.clients.set(this.Clients.length)

      // remoteLogger.Store('NEW_CONNECTION', {
      //  ip: clientState.ip,
      //  headers: clientState.headers},
      //  remoteLogger.Severity.INFO
      // )

      ws.on('migrate', () => {
        clientState.preferredServer = this.getUplinkServer(clientState)
        this.connectUplink(clientState)
      })

      ws.on('message', (message: string) => {
        let relayMessage = true
        log.extend('Ws')('Received request: %s', message)
        clientState.counters.txCount++
        clientState.counters.txSize += message.length

        if (message.length <= 1024) {
          try {
            const messageJson = JSON.parse(message)
            if (typeof messageJson.__api !== 'undefined') {
              relayMessage = false
              if (messageJson.__api === 'state') {
                ws.send(JSON.stringify({
                  endpoint: typeof clientState.uplink !== 'undefined' ? clientState.uplink.url : null,
                  preferredServer: clientState.preferredServer,
                  uplinkType: clientState.uplinkType,
                  counters: clientState.counters,
                  headers: clientState.headers,
                  uplinkCount: clientState.uplinkCount,
                  connectMoment: clientState.connectMoment
                }))
              }
              if (messageJson.__api === 'upgrade') {
                /**
                 * Todo: verification, payments, ...
                 */
                clientState.uplinkType = 'priority'
                // clientState.preferredServer = this.getUplinkServer(clientState)
                // this.connectUplink(clientState)
                ws.emit('migrate')
              }
              if (messageJson.__api === 'downgrade') {
                clientState.uplinkType = 'basic'
                // clientState.preferredServer = this.getUplinkServer(clientState)
                // this.connectUplink(clientState)
                ws.emit('migrate')
              }
            }
          } catch (e) {
            //
          }
        }

        if (relayMessage) {
          if (typeof clientState.uplink !== 'undefined' && clientState.uplink.readyState === clientState.uplink.OPEN) {
            clientState.uplink.send(message)
          } else {
            // BUFFER MESSAGE
            clientState.uplinkMessageBuffer.push(message)
            log('Storing new buffered message')
          }
        }
      })

      ws.on('close', (code: number, reason: string) => {
        clientState.closed = true

        this.Clients.splice(this.Clients.indexOf(clientState), 1)
        metrics.clients.set(this.Clients.length)

        log.extend('Ws')('Closed socket @code', code, reason)

        if (typeof clientState.uplink !== 'undefined') {
          clientState.uplink.close()
        }
      })
    })
  }
}

export default ProxyServer
