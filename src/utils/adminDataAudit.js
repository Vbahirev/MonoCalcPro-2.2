export function isPrimitiveValue(value) {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null
}

export function formatPreviewValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  if (typeof value === 'object') {
    if (Array.isArray(value)) return `Array(${value.length})`
    return `Object(${Object.keys(value).length})`
  }
  return String(value)
}

export function buildDocAnomalies(moduleId, record) {
  const anomalies = []
  const data = record?.__raw || record?.data || {}

  if (moduleId === 'users') {
    if (!String(data?.displayName || '').trim()) anomalies.push('Нет displayName')
    if (!String(data?.role || '').trim()) anomalies.push('Нет роли')
    if (data?.permissions && typeof data.permissions !== 'object') anomalies.push('permissions не объект')
  }

  if (moduleId === 'settings') {
    if (!Object.keys(data || {}).length) anomalies.push('Пустой документ настроек')
    const primitiveCount = Object.values(data || {}).filter((value) => isPrimitiveValue(value)).length
    if (!primitiveCount) anomalies.push('Нет простых полей для безопасного редактирования')
  }

  if (moduleId === 'history') {
    const name = data?.name || data?.state?.project?.name
    if (!String(name || '').trim()) anomalies.push('Нет названия проекта')
    if (!String(data?.savedAt || '').trim()) anomalies.push('Нет savedAt')
  }

  if (moduleId === 'trash') {
    if (!String(data?.itemType || data?.type || '').trim()) anomalies.push('Не указан тип удалённых данных')
    if (!String(data?.expiresAtISO || '').trim() && !data?.restoreUntil) anomalies.push('Нет срока хранения')
  }

  return anomalies
}

export function buildSchemaSummary(docs) {
  const fieldMap = new Map()

  for (const entry of docs || []) {
    const data = entry?.__raw || entry?.data || {}
    for (const [key, value] of Object.entries(data)) {
      if (!fieldMap.has(key)) {
        fieldMap.set(key, { key, count: 0, primitive: 0, object: 0, array: 0, boolean: 0, number: 0, string: 0, nullish: 0 })
      }

      const row = fieldMap.get(key)
      row.count += 1

      if (value === null || value === undefined) {
        row.nullish += 1
        continue
      }
      if (Array.isArray(value)) {
        row.array += 1
        continue
      }
      if (typeof value === 'object') {
        row.object += 1
        continue
      }
      row.primitive += 1
      if (typeof value === 'boolean') row.boolean += 1
      if (typeof value === 'number') row.number += 1
      if (typeof value === 'string') row.string += 1
    }
  }

  return [...fieldMap.values()]
    .sort((left, right) => right.count - left.count)
    .map((row) => ({
      key: row.key,
      coverage: row.count,
      shape: row.array ? 'array' : row.object ? 'object' : row.boolean ? 'boolean' : row.number ? 'number' : row.string ? 'string' : 'mixed',
      details: [
        row.string ? `str ${row.string}` : '',
        row.number ? `num ${row.number}` : '',
        row.boolean ? `bool ${row.boolean}` : '',
        row.array ? `arr ${row.array}` : '',
        row.object ? `obj ${row.object}` : '',
        row.nullish ? `null ${row.nullish}` : '',
      ].filter(Boolean).join(' · '),
    }))
}

export function buildControlledSectionRows(data) {
  return Object.entries(data || {})
    .filter(([, value]) => !isPrimitiveValue(value))
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return { key, kind: 'array', summary: `${value.length} элементов` }
      }
      if (value && typeof value === 'object') {
        return { key, kind: 'object', summary: `${Object.keys(value).length} полей` }
      }
      return { key, kind: typeof value, summary: 'Сложная структура' }
    })
}