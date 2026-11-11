'use strict'

// Cofre VOLATIL para dados efemeros. Nao protege registros SQLite preexistentes.
const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto')

class SessionVault {
  #keys = new Map()
  #closed = false

  createKey(recordId) {
    if (this.#closed) throw new Error('Cofre encerrado')
    if (typeof recordId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(recordId)) {
      throw new TypeError('Identificador invalido')
    }
    if (this.#keys.has(recordId)) throw new Error('Chave ja existente')
    this.#keys.set(recordId, randomBytes(32))
  }

  encrypt(recordId, plaintext) {
    if (this.#closed) throw new Error('Cofre encerrado')
    const key = this.#keys.get(recordId)
    if (!key) throw new Error('Chave indisponivel')
    if (typeof plaintext !== 'string') throw new TypeError('Conteudo invalido')
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(recordId, 'utf8'))
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return { algorithm: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
  }

  decrypt(recordId, envelope) {
    if (this.#closed) throw new Error('Cofre encerrado')
    const key = this.#keys.get(recordId)
    if (!key) throw new Error('Chave indisponivel')
    if (!envelope || envelope.algorithm !== 'aes-256-gcm') throw new Error('Envelope invalido')
    const iv = Buffer.from(envelope.iv, 'base64')
    const tag = Buffer.from(envelope.tag, 'base64')
    if (iv.length !== 12 || tag.length !== 16) throw new Error('Envelope invalido')
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(Buffer.from(recordId, 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8')
  }

  revoke(recordId) {
    const key = this.#keys.get(recordId)
    if (!key) return false
    key.fill(0)
    this.#keys.delete(recordId)
    return true
  }

  close() {
    for (const id of this.#keys.keys()) this.revoke(id)
    this.#closed = true
  }
}

module.exports = { SessionVault }
