import type {
  CapabilityModel,
  Resource,
  ResourceDetail,
} from '../../../src/catalog'

const DOMAIN_CODES = ['P01', 'P02', 'P03', 'C01', 'C02', 'C03']

export const capabilityMapModel: CapabilityModel = {
  code: 'Issue #52 300+ L3 能力模型',
  version: 'test-fixture-v1',
  domains: DOMAIN_CODES.map((domainCode, domainIndex) => ({
    code: domainCode,
    name: `${domainCode} 能力域`,
    p4_description: `${domainCode} P4 核心定位`,
    p5_description: `${domainCode} P5 核心定位`,
    p6_description: `${domainCode} P6 核心定位`,
    p7_description: `${domainCode} P7 核心定位`,
    p8_description: `${domainCode} P8 核心定位`,
    children: Array.from({ length: 4 }, (_, l2Index) => {
      const l2Code = `${domainCode}.${String(l2Index + 1).padStart(2, '0')}`
      return {
        code: l2Code,
        name: `${domainCode} 分组 ${l2Index + 1}`,
        p4_description: `${l2Code} P4`,
        p5_description: `${l2Code} P5`,
        p6_description: `${l2Code} P6`,
        p7_description: `${l2Code} P7`,
        p8_description: `${l2Code} P8`,
        children: Array.from({ length: 14 }, (_, l3Index) => {
          const l3Code = `${l2Code}.${String(l3Index + 1).padStart(2, '0')}`
          return {
            code: l3Code,
            name:
              domainIndex === 1 && l2Index === 2 && l3Index === 6
                ? '跨域搜索目标能力'
                : `${l3Code} 紧凑能力项`,
            p4_description: `${l3Code} P4 完整描述`,
            p5_description: `${l3Code} P5 完整描述`,
            p6_description: `${l3Code} P6 完整描述`,
            p7_description: `${l3Code} P7 完整描述`,
            p8_description: `${l3Code} P8 完整描述`,
            recommended_start_level: 'P4',
            materials_text: '',
            expected_output: `${l3Code} 输出`,
            estimated_hours: '8',
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
      name: '跨域搜索目标能力',
      l1_code: 'P02',
      l1_name: 'P02 能力域',
      l2_code: 'P02.03',
      l2_name: 'P02 分组 3',
    },
  ],
}
