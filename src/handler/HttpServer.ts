'use strict'

import Debug from 'debug'
import {ProxyServer} from './'
import {Client} from './types'
import {Request, Response} from 'express'
const log = Debug('app').extend('HttpServer')
const logAdmin = log.extend('Admin')

class HttpServer {
  constructor (app: any, proxy: ProxyServer) {
    const getClientMap = (Clients: Array<Client>, req: Request) => {
      return Clients.map(c => {
        return {
          id: c.id,
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

    app.get('/', (req: Request, res: Response) => {
      res.send('rippled-ws-server')
    })
    /**
     * TODO: ADMIN
     */
    app.get('/kill/:client', (req: Request, res: Response) => {
      logAdmin('-- ADMIN KILL --')
      const matchingClient = proxy.getClients().filter(c => {
        return c.id === Number(req.params.client)
      })
      if (matchingClient.length === 1) {
        res.json({params: req.params, client: getClientMap(matchingClient, req)[0]})
        matchingClient[0].socket.close()
      } else {
        res.json({error: true})
      }
    })

    app.get('/uplink/:uplink/:action', (req: Request, res: Response) => {
      logAdmin('-- ADMIN UPLINK ACTION --')
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

    app.get('/add-uplink/:type/:proto/:uri/:hash', (req: Request, res: Response) => {
      logAdmin('-- ADMIN ADD UPLINK --')
      if (['basic', 'priority'].indexOf(req.params.type) > -1 && ['ws', 'wss'].indexOf(req.params.proto) > -1) {
        const uri = req.params.proto + '://' + req.params.uri + '/#' + req.params.hash
        proxy.addUplinkServer(req.params.type, uri)
        const newUplink = proxy.getUplinkServers().filter(s => {
          return s.type === req.params.type && s.endpoint === uri
        })
        res.json({params: req.params, uplink: newUplink})
      } else {
        res.json({error: true})
      }
    })

    app.get('/status', (req: Request, res: Response) => {
      logAdmin('-- ADMIN STATUS --')
      res.json({
        clients: {
          call: {
            params: req.params,
            query: req.query
          },
          uplinks: proxy.getUplinkServers(),
          count: proxy.getClients().length,
          clientDetails: getClientMap(proxy.getClients(), req)
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
