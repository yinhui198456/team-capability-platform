import type {
  CapabilityModel,
  Resource,
  ResourceDetail,
} from '../../../src/catalog'

const DOMAIN_SPECS = [
  ['P01', 10, [9, 9, 8, 8, 8, 8, 8, 8, 8, 8]],
  ['P02', 10, [7, 7, 7, 7, 7, 6, 0, 0, 0, 0]],
  ['P03', 9, [8, 8, 8, 8, 8, 8, 8, 7, 7]],
  ['C01', 7, [6, 6, 6, 6, 6, 6, 6]],
  ['C02', 7, [5, 5, 5, 5, 5, 5, 5]],
  ['C03', 8, [5, 5, 5, 5, 5, 5, 5, 5]],
] as const

const startLevels = ['P4', 'P5', 'P4–P5', 'P6', 'P5–P6', 'P6–P8']

export const capabilityMapModel: CapabilityModel = {
  code: '技术架构与开发角色能力模型',
  version: 'v1.0',
  domains: DOMAIN_SPECS.map(([domainCode, l2Count, l3Counts]) => ({
    code: domainCode,
    name: `${domainCode} 能力域`,
    overview: `${domainCode} 一级能力域概述`,
    children: Array.from({ length: l2Count }, (_, l2Index) => {
      const l2Code = `${domainCode}.${String(l2Index + 1).padStart(2, '0')}`
      return {
        code: l2Code,
        name: `${domainCode} 能力标准 ${l2Index + 1}`,
        p4_description: `${l2Code} P4 职级要求`,
        p5_description: `${l2Code} P5 职级要求`,
        p6_description: `${l2Code} P6 职级要求`,
        p7_description: `${l2Code} P7 职级要求`,
        p8_description: `${l2Code} P8 职级要求`,
        children: Array.from({ length: l3Counts[l2Index] }, (_, l3Index) => {
          const l3Code = `${l2Code}.${String(l3Index + 1).padStart(2, '0')}`
          const isSearchTarget = l3Code === 'P02.03.07'
          return {
            code: l3Code,
            name: isSearchTarget
              ? '跨域搜索目标达成路径'
              : `${l3Code} 学习实践项`,
            recommended_start_level: startLevels[l3Index % startLevels.length],
            materials_text: isSearchTarget ? 'ISSUE52-M001' : '',
            expected_output: `${l3Code} 验收输出`,
            estimated_hours: l3Index % 2 ? '4–6' : '8',
            output_type: l3Index % 3 ? '实践输出' : null,
            notes: null,
            resources: [],
            unmatched_materials: [],
          }
        }),
      }
    }),
  })),
}

export const capabilityMapResources: Resource[] = [
  {
    material_code: 'ISSUE52-M001',
    name: '能力地图测试资源',
    material_type: '文档',
    source_text: 'Issue #52 fixture',
    purpose: '验证资源页反向链接',
    status: '已提供附件',
    l3_count: 1,
  },
]

export const capabilityMapResourceDetail: ResourceDetail = {
  ...capabilityMapResources[0],
  l3_nodes: [
    {
      code: 'P02.03.07',
      name: '跨域搜索目标达成路径',
      l1_code: 'P02',
      l1_name: 'P02 能力域',
      l2_code: 'P02.03',
      l2_name: 'P02 能力标准 3',
    },
  ],
}
