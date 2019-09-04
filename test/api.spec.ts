'use strict'

process.env.PORT = '41625'
import WebSocket from 'ws'

const {shutdown} = require('../src')

describe('rippled websocket proxy', () => {
  let client: WebSocket

  beforeAll(async () => {
    console.log('Started server')
    await new Promise((resolve, reject) => {
      console.log('Connecting client')
      client = new WebSocket('ws://localhost:' + process.env.PORT)
      client.on('error', e => reject(e))
      client.on('open', () => {
        console.log('Client connected')
        resolve()
      })
    })
  })

  afterAll(async () => {
    console.log('Disconnecting client')
    await new Promise((resolve, reject) => {
      client.on('close', () => {
        console.log('Client disconnected')
        resolve()
      })
      client.on('error', () => reject(new Error('Client disconnect error')))
      client.close()
    })
    console.log('Shutting down server')
    await shutdown()
    console.log('Server down')
  })

  it('should be able to fetch rippled server_info', async () => {
    await expect(new Promise((resolve, reject) => {
      client.send(JSON.stringify({
        command: 'server_info'
      }))
      client.on('message', message => {
        const json = JSON.parse(message.toString())
        if (typeof json.status === 'string') {
          resolve(json.status)
        } else {
          reject(new Error('WS Response missing `status` key'))
        }
      })
    })).resolves.toEqual('success')
  })
})
