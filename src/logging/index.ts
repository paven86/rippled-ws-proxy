'use strict'

// import assert from 'assert'
import Debug from 'debug'
const log = Debug('app').extend('logging')

const {Logging} = require('@google-cloud/logging')
const logging = new Logging({projectId: 'xrpledgerdata'})
const glog = logging.log('rippled-test')

enum Severity {
  DEFAULT,
  DEBUG,
  INFO,
  NOTICE,
  WARNING,
  ERROR,
  CRITICAL,
  ALERT,
  EMERGENCY
}

const Store = async (text: string = '', data: Object, severity:Severity = Severity.DEFAULT): Promise<void> => {
  // The metadata associated with the entry
  const metadata = {severity: severity}

  const entry = glog.entry(metadata, Object.assign({text: text}, data))

  await glog.write(entry)
  log(`Logged: ${text}`)

  return Promise.resolve()
}

export {
  Severity,
  Store
}
