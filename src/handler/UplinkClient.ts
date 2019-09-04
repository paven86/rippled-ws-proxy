'use strict'

import Debug from 'debug'
import WebSocket from 'ws'
const log = Debug('app')
import {Client} from './types'
import io from '@pm2/io'

const metrics = {
  messages: io.counter({name: '# messages'})
}

class UplinkClient extends WebSocket {
  private closedOnPurpose: boolean = false
  private clientState: Client | undefined
  private id: number = 0
  private connectTimeout: any
  private pingInterval: any
  private pongTimeout: any

  constructor (clientState: Client, endpoint: string) {
    // super(UplinkServers.basic)
    super(endpoint, {headers: {'X-Forwarded-For': clientState.ip, 'X-User': clientState.ip}})

    log(`Construct new UplinkClient to ${endpoint}`)

    this.clientState = clientState
    this.id = clientState.uplinkCount + 1

    // remoteLogger.Store('Some Text', {localData: true}, remoteLogger.Severity.ALERT)
    this.connectTimeout = setTimeout(() => {
      log(`Close. Connection timeout.`)
      this.close()
    }, 10 * 1000)

    this.on('open', () => {
      clearTimeout(this.connectTimeout)
      this.pingInterval = setInterval(() => {
        this.send(JSON.stringify({id: 'CONNECTION_PING_TEST', command: 'ping'}))
      }, 2500)


      log('UplinkClient connected to ', endpoint)
      log('Subscriptions to replay ', this.clientState!.uplinkSubscriptions.length)
      this.clientState!.uplinkSubscriptions.forEach((s: any): void => {
        const m = JSON.stringify(Object.assign({}, {
          ...s,
          id: 'REPLAYED_SUBSCRIPTION'
        }))
        this.send(m)
      })
    })

    this.on('close', () => {
      clearTimeout(this.connectTimeout)
      clearTimeout(this.pongTimeout)
      clearInterval(this.pingInterval)

      log('>> UplinkClient disconnected from ', endpoint)
      if (this.clientState!.closed) {
        log(`     -> Don't reconnect, client gone`)
      } else {
        if (this.closedOnPurpose) {
          log('     -> On purpose :)')
        } else {
          log('     -> [NOT ON PURPOSE] Client still here - Instruct parent to find new uplink')
          this.emit('gone')
        }
      }

      this.clientState = undefined
      log.destroy()
    })

    this.on('message', data => {
      clearTimeout(this.connectTimeout)

      const firstPartOfMessage = data.toString().slice(0, 100).trim()
      if (!firstPartOfMessage.match(/(NEW_CONNECTION_TEST|CONNECTION_PING_TEST|REPLAYED_SUBSCRIPTION)/)) {
        log('Message from ', endpoint, ':', firstPartOfMessage)
        metrics.messages.inc()
        this.clientState!.counters.rxCount++
        this.clientState!.counters.rxSize += data.toString().length
        this.clientState!.socket.send(data)
      } else {
        if (firstPartOfMessage.match(/CONNECTION_PING_TEST/)) {
          clearTimeout(this.pongTimeout)
          this.pongTimeout = setTimeout(() => {
            log(`!! Not received a PONG for some time (15sec), assume uplink ${endpoint} GONE`)
            this.close()
          }, 15 * 1000)
        }
      }
    })

    this.on('ping', () => {
      this.pong()
    })

    this.on('error', error => {
      clearTimeout(this.connectTimeout)
      clearTimeout(this.pongTimeout)
      clearInterval(this.pingInterval)

      if (!error.message.match(/closed before.+established/)) {
        log('UPLINK CONNECTION ERROR', endpoint, ': ', error.message)
      }
    })

    this.clientState.uplinkCount++
  }

  getId (): number {
    return this.id
  }

  close (code?: number, data?: string) {
    if (typeof code !== 'undefined' && typeof data !== 'undefined' && data === 'ON_PURPOSE') {
      this.closedOnPurpose = true
    }
    try {
      super.close()
    } catch (e) {
      log('!! WS Close ERROR', e.message)
    }
  }

  send (message: string) {
    if (typeof this !== 'undefined' && this.readyState === this.OPEN) {
      if (message.length <= 1024 * 1024) {
        /**
         * Register subscriptions
         */
        try {
          const messageJson = JSON.parse(message)

          if (typeof messageJson.command === 'string') {
            const command = messageJson.command.toLowerCase()

            /**
             * Handle subscriptions
             */
            if (['subscribe','unsubscribe'].indexOf(command) > -1) {
              let appendSubscription = true
              if (typeof messageJson.id !== 'undefined') {
                if (messageJson.id === 'REPLAYED_SUBSCRIPTION') {
                  appendSubscription = false
                }
                messageJson.id = undefined
              }
              if (this.clientState!.uplinkSubscriptions.length > 0) {
                // If last message equals current message, ignore it.
                const subscriptionsString = this.clientState!.uplinkSubscriptions.map(s => {
                  return JSON.stringify(s)
                })
                const lastMessage = subscriptionsString.slice(-1)[0]
                const thisMessageString = JSON.stringify(messageJson)

                // Message already exists
                if (lastMessage === thisMessageString) {
                  appendSubscription = false
                }

                // Got no unsubscribes, so subscribes may be unique
                if (this.clientState!.uplinkSubscriptions.filter(s => {
                  return s.command.toLowerCase() === 'unsubscribe'
                }).length < 1) {
                  if (subscriptionsString.indexOf(thisMessageString) > -1) {
                    appendSubscription = false
                  }
                }
              }
              if (appendSubscription) {
                this.clientState!.uplinkSubscriptions.push(messageJson)
              }
            }
          }
        } catch (e) {
          log('Error parsing message JSON', e.message)
        }
      }

      super.send(message)
    } else {
      if (!message.slice(0, 100).match(/NEW_CONNECTION_TEST|CONNECTION_PING_TEST|REPLAYED_SUBSCRIPTION/)) {
        log('UplinkClient sent message: UPLINK NOT CONNECTED YET. Added to buffer.')
        this.clientState!.uplinkMessageBuffer.push(message)
      }
    }
  }
}

export default UplinkClient
