'use strict'

import Debug from 'debug'
import {ProxyServer} from './'
import {Request, Response} from 'express'
const log = Debug('app').extend('HttpServer')

class HttpServer {
  constructor (app: any, proxy: ProxyServer) {
    app.get('/', (req: Request, res: Response) => {
      res.send('rippled-ws-server')
    })
    /**
     * TODO: ADMIN
     */
    app.get('/uplink/:uplink/:action', (req: Request, res: Response) => {
      const matchingUplink = proxy.getUplinkServers().filter(s => {
        return s.id === req.params.uplink
      })
      if (matchingUplink.length === 1 && typeof matchingUplink[0].id === 'string') {
        proxy.updateUplinkServer(matchingUplink[0].id, req.params.action)
        res.json({params: req.params, uplink: matchingUplink[0].endpoint})
      } else {
        res.json({error: true})
      }
    })

    app.get('/status', (req: Request, res: Response) => {
      log.extend('Admin')('-- ADMIN CALL --')
      res.json({
        clients: {
          call: {
            params: req.params,
            query: req.query
          },
          uplinks: proxy.getUplinkServers(),
          count: proxy.getClients().length,
          clientDetails: proxy.getClients().map(c => {
            return {
              ip: c.ip,
              uptime: Math.ceil((new Date().getTime() - c.connectMoment.getTime()) / 1000),
              counters: {
                messages: c.counters,
                state: {
                  queue: this.lengthOrDetails(c.uplinkMessageBuffer, req),
                  subscriptions: this.lengthOrDetails(c.uplinkSubscriptions, req)
                }
              },
              headers: c.headers,
              uplinkCount: c.uplinkCount,
              uplink: {
                state: c.socket.readyState,
                endpoint: c.uplink
                  ? c.uplink!.url
                  : null
              }
            }
          })
        }
      })
    })
  }

  lengthOrDetails (object: Array<string | object>, req: Request): Array<string | object> | number {
    if (req.query.details) {
      return object
    }
    return object.length
  }
}

export default HttpServer
