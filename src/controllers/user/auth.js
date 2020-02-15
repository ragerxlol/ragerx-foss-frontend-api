import { general } from '../../constants'
import { InternalError, UserError } from '../../errors'

import { pool } from '../../database'

import { randomBytes } from 'crypto'
import wp from 'whirlpool-js'
import keccak from 'keccak'
import jwt from 'jsonwebtoken'

export async function hashPassword(username, password) {
  const u = Buffer.from((await wp.encP(username.toLowerCase(), 'hex')).substring(0, 64), 'hex').toString('binary')
  const p = Buffer.from((await wp.encP(password, 'hex')).substring(0, 64), 'hex').toString('binary')
  const i = Buffer.from((await wp.encP(general.salt + u + p, 'hex')).substring(0, 64), 'hex').toString('binary')
  return await wp.encP(general.salt + i, 'hex')
}

const query_authorize_password = {
  name: 'authorize-password',
  text: `
  SELECT *
  FROM users
  WHERE LOWER(username) = LOWER($1) AND password = $2
  `
}

export function authorizePassword(username, password) {
  return new Promise(async (resolve, reject) => {
    try {
      const password_hash = await hashPassword(username, password)
      const res = await pool.query(query_authorize_password.text, [username, password_hash])
      if(res.rows.length) {
        return resolve(res.rows[0])
      }
    } catch {
    }
    resolve(false)
  })
}

export function authorizeToken(auth_token) {
  return new Promise((resolve, reject) => {
    jwt.verify(auth_token, general.jwt_secret, (error, payload) => {
      if(error) {
        return resolve(false)
      }
      resolve(payload)
    })
  })
}

export function generateToken(user) {
  return new Promise((resolve, reject) => {
    const payload = {
      username: user.username,
      uid: user.uid
    }
    jwt.sign(payload, general.jwt_secret, (error, token) => {
      if(error) {
        return resolve(false)
      }
      resolve(token)
    })
  })
}

export function generateSalt() {
  return new Promise((resolve, reject) => {
    randomBytes(8, (error, buf) => {
      if(error) {
        return resolve(false)
      }
      resolve(buf.toString('base64'))
    })
  })
}

export function generateUserHash(username, salt) {
  return keccak('keccak256').update(username + salt).digest().toString('hex').substring(0, 12)
}
