import { resolve } from 'node:path'
import process from 'node:process'

export function localDataRoot() {
  const configured = process.env.MIAO_DATA_DIR?.trim()
  return resolve(configured || '.data')
}

export function localDataPath(...parts) {
  return resolve(localDataRoot(), ...parts)
}
