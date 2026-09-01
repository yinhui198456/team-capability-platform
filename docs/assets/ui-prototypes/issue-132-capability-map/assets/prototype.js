(function () {
  'use strict'

  var LEVELS = ['P4', 'P5', 'P6', 'P7', 'P8']
  var KIND_LABEL = {
    L1: '能力域',
    L2: '能力标准',
    L3: '达成路径',
  }

  function levelSet(subject) {
    return {
      P4: {
        summary: '在指导下完成标准场景',
        full:
          '能够说明' +
          subject +
          '的基本范围，在明确步骤和评审支持下完成标准场景，并提交可复核的过程记录与结果。',
      },
      P5: {
        summary: '独立交付并处理常见问题',
        full:
          '能够独立完成' +
          subject +
          '的设计与交付，识别常见风险、排查问题，并通过文档、演示或代码评审证明结果。',
      },
      P6: {
        summary: '负责复杂模块与质量闭环',
        full:
          '能够负责复杂' +
          subject +
          '模块，建立质量与验收边界，协调上下游完成交付，并沉淀可复用的工程方法。',
      },
      P7: {
        summary: '设计跨团队方案与演进路径',
        full:
          '能够设计跨团队的' +
          subject +
          '方案，权衡成本、风险和演进节奏，推动关键决策落地并对长期结果负责。',
      },
      P8: {
        summary: '形成组织级方法与判断',
        full:
          '能够形成组织级' +
          subject +
          '方法和技术判断，定义关键标准，解决高不确定性问题，并通过人才与机制建设扩大影响。',
      },
    }
  }

  function l3(code, name, startLevel, output, hours, resources) {
    return {
      code: code,
      name: name,
      startLevel: startLevel,
      output: output,
      hours: hours,
      resources: resources || '暂未关联资源',
    }
  }

  function l2(code, name, count, children, levels) {
    return {
      code: code,
      name: name,
      count: count,
      children: children || [],
      levels: levels || levelSet(name),
    }
  }

  var data = [
    {
      code: 'P01',
      name: 'Data Infra 能力',
      overview: '覆盖 Data Infra 产品、平台、数据库与数据治理的核心能力标准。',
      l2Count: 10,
      l3Count: 82,
      groups: [
        l2('P01.01', 'Data Infra 产品体系认知', 9, [
          l3(
            'P01.01.01',
            'TDC / TDH / ArgoDB / TDS 产品定位',
            'P4',
            '产品定位说明与场景边界对照',
            '8 小时',
            'P01-M001 · 产品体系材料',
          ),
          l3(
            'P01.01.02',
            '产品能力边界与选型判断',
            'P5',
            '选型判断记录',
            '6 小时',
          ),
          l3(
            'P01.01.03',
            '典型客户场景拆解',
            'P4–P5',
            '场景拆解文档',
            '6 小时',
          ),
        ]),
        l2('P01.02', 'TDH 平台与大数据组件能力', 9),
        l2('P01.03', 'TDC 多租户数据平台能力', 8),
        l2('P01.04', 'ArgoDB 使用与优化能力', 8),
        l2('P01.05', 'TDS 数据开发能力', 8),
        l2('P01.06', 'TDS 数据治理能力', 8),
        l2('P01.07', '数仓 / 湖仓建模与数据流转能力', 8),
        l2('P01.08', '数据集成与实时同步能力', 8),
        l2('P01.09', '资源规划、性能优化与稳定性基础能力', 8),
        l2('P01.10', '数据安全、权限与合规能力', 8),
      ],
    },
    {
      code: 'P02',
      name: 'AI Infra / Agent 能力',
      overview: '覆盖 AI 工程、模型应用、Agent 系统与交付治理的能力标准。',
      l2Count: 10,
      l3Count: 41,
      groups: [
        l2('P02.01', 'AI Infra 基础与运行环境', 7),
        l2(
          'P02.02',
          'Agent / 应用链工程',
          8,
          [
            l3(
              'P02.02.01',
              'Agent 工具链搭建',
              'P4',
              '可运行工具链与安装说明',
              '8 小时',
              'P02-M004 · Agent 工程实践',
            ),
            l3(
              'P02.02.02',
              'Prompt 与上下文工程',
              'P4',
              'Prompt 评测记录',
              '6 小时',
            ),
            l3(
              'P02.02.03',
              'RAG 检索链路实现',
              'P5',
              '检索质量评测报告',
              '12 小时',
            ),
            l3(
              'P02.02.04',
              '工具调用与协议集成',
              'P5',
              '工具集成演示',
              '10 小时',
            ),
            l3(
              'P02.02.05',
              'Agent 状态与记忆管理',
              'P5–P6',
              '状态恢复测试记录',
              '12 小时',
            ),
            l3(
              'P02.02.06',
              '多 Agent 协作与编排',
              'P6',
              '协作链路设计说明',
              '16 小时',
            ),
            l3(
              'P02.02.07',
              'AI 应用评测与可观测性',
              'P6',
              '质量指标与回归报告',
              '14 小时',
            ),
            l3(
              'P02.02.08',
              'Agent / 应用链开发与发布',
              'P5',
              '可部署应用、发布说明与回滚验证',
              '16 小时',
              'P02-M011 · Agent 应用发布指南',
            ),
          ],
          {
            P4: {
              summary: '在指导下完成单链路开发',
              full:
                '能够在既定框架和接口约束下完成单一 Agent / 应用链开发，正确接入模型与工具，并提交运行说明、基本测试和可复核输出。',
            },
            P5: {
              summary: '独立完成应用链交付与发布',
              full:
                '能够独立设计并交付 Agent / 应用链，处理状态、工具调用、异常与发布配置，完成质量验证、上线说明和可执行回滚方案。',
            },
            P6: {
              summary: '负责复杂链路与质量治理',
              full:
                '能够负责复杂 Agent 系统的模块划分、可观测性、评测和发布治理，协调上下游并建立稳定的工程质量门禁。',
            },
            P7: {
              summary: '设计平台级架构与演进路线',
              full:
                '能够设计跨业务复用的 Agent 应用平台架构，权衡模型、成本、性能和安全，推动平台能力与交付标准持续演进。',
            },
            P8: {
              summary: '形成组织级 Agent 工程标准',
              full:
                '能够定义组织级 Agent 工程与发布方法，解决高不确定性系统问题，形成可复制的技术判断、人才培养和治理机制。',
            },
          },
        ),
        l2('P02.03', '大模型应用与评测', 7),
        l2('P02.04', 'AI 数据与知识工程', 7),
        l2('P02.05', 'AI 服务性能与成本', 7),
        l2('P02.06', 'AI 安全与治理', 5),
        l2('P02.07', 'AI 平台产品化', 0, []),
        l2('P02.08', '模型服务运营', 0, []),
        l2('P02.09', 'AI 应用业务协同', 0, []),
        l2('P02.10', 'AI 能力治理与复盘', 0, []),
      ],
    },
    {
      code: 'P03',
      name: 'Coding 能力',
      overview: '覆盖编码、工程质量、调试、设计与交付协作的能力标准。',
      l2Count: 9,
      l3Count: 70,
      groups: [
        l2('P03.01', '编码基础与代码质量', 8),
        l2('P03.02', '调试与问题定位', 8),
        l2('P03.03', '模块设计与重构', 8),
        l2('P03.04', '自动化测试与交付', 8),
        l2('P03.05', '工程协作与评审', 8),
      ],
    },
    {
      code: 'C01',
      name: '基本办公能力',
      overview: '覆盖信息处理、文档表达、协作工具与工作效率的通用能力。',
      l2Count: 7,
      l3Count: 42,
      groups: [
        l2('C01.01', '信息检索与结构化表达', 6, [
          l3(
            'C01.01.01',
            '信息检索与来源核验',
            'P4',
            '带来源的调研摘要',
            '4 小时',
          ),
          l3(
            'C01.01.02',
            '结构化文档编写',
            'P4',
            '可评审方案文档',
            '6 小时',
          ),
        ]),
        l2('C01.02', '数据表格与基础分析', 6),
        l2('C01.03', '会议与行动项管理', 6),
        l2('C01.04', '演示与汇报表达', 6),
        l2('C01.05', '个人工作效率', 6),
      ],
    },
    {
      code: 'C02',
      name: '沟通协作',
      overview: '覆盖协同沟通、反馈、冲突处理和跨角色合作的通用能力。',
      l2Count: 7,
      l3Count: 35,
      groups: [
        l2('C02.01', '目标澄清与信息同步', 5),
        l2('C02.02', '反馈与复盘', 5),
        l2('C02.03', '跨团队协作', 5),
        l2('C02.04', '冲突识别与处理', 5),
        l2('C02.05', 'Buddy 协作', 5),
      ],
    },
    {
      code: 'C03',
      name: '学习创新',
      overview: '覆盖持续学习、实践迁移、复盘改进与知识分享的通用能力。',
      l2Count: 8,
      l3Count: 40,
      groups: [
        l2('C03.01', '学习目标与路径设计', 5),
        l2('C03.02', '实践与知识迁移', 5),
        l2('C03.03', '复盘与持续改进', 5),
        l2('C03.04', '知识沉淀与分享', 5),
        l2('C03.05', '创新问题探索', 5),
      ],
    },
  ]

  var state = {
    activeDomain: 'P01',
    selectedCode: '',
    selectedKind: '',
    invalidHash: '',
    expanded: {},
    selectedLevel: null,
    searchResults: [],
    activeSearchIndex: -1,
    searchOpen: false,
    drawerCode: '',
    returnFocusCode: '',
  }

  data.forEach(function (domain) {
    state.expanded[domain.code] = new Set()
  })

  var appShell = document.querySelector('.app-shell')
  var tabs = document.querySelector('.domain-tabs')
  var domainContent = document.querySelector('.domain-content')
  var notFound = document.querySelector('#not-found')
  var domainTitle = document.querySelector('#domain-title')
  var domainOverviewCopy = document.querySelector('#domain-overview-copy')
  var domainOverviewCounts = document.querySelector('#domain-overview-counts')
  var l2Count = document.querySelector('#l2-count')
  var l2List = document.querySelector('.l2-list')
  var pathError = document.querySelector('#path-error')
  var pathErrorCopy = document.querySelector('#path-error-copy')
  var searchInput = document.querySelector('#capability-search')
  var searchResultsElement = document.querySelector('#search-results')
  var clearSearch = document.querySelector('.clear-search')
  var liveStatus = document.querySelector('#live-status')
  var drawer = document.querySelector('.drawer')
  var drawerBackdrop = document.querySelector('.drawer-backdrop')
  var drawerTitle = document.querySelector('#drawer-title')
  var drawerName = document.querySelector('#drawer-name')
  var drawerBody = document.querySelector('.drawer-body')

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;')
  }

  function domainByCode(code) {
    return data.find(function (domain) {
      return domain.code === code
    })
  }

  function findNode(code) {
    var domain = domainByCode(code)
    if (domain) return { kind: 'L1', code: code, domain: domain }

    for (var domainIndex = 0; domainIndex < data.length; domainIndex += 1) {
      var currentDomain = data[domainIndex]
      for (
        var groupIndex = 0;
        groupIndex < currentDomain.groups.length;
        groupIndex += 1
      ) {
        var group = currentDomain.groups[groupIndex]
        if (group.code === code) {
          return {
            kind: 'L2',
            code: code,
            domain: currentDomain,
            group: group,
          }
        }
        var path = group.children.find(function (candidate) {
          return candidate.code === code
        })
        if (path) {
          return {
            kind: 'L3',
            code: code,
            domain: currentDomain,
            group: group,
            path: path,
          }
        }
      }
    }
    return null
  }

  function searchIndex() {
    var index = []
    data.forEach(function (domain) {
      index.push({
        kind: 'L1',
        code: domain.code,
        name: domain.name,
        domain: domain,
      })
      domain.groups.forEach(function (group) {
        index.push({
          kind: 'L2',
          code: group.code,
          name: group.name,
          domain: domain,
          group: group,
        })
        group.children.forEach(function (path) {
          index.push({
            kind: 'L3',
            code: path.code,
            name: path.name,
            domain: domain,
            group: group,
            path: path,
          })
        })
      })
    })
    return index
  }

  var index = searchIndex()

  function currentHash() {
    try {
      return decodeURIComponent(window.location.hash.slice(1)).trim()
    } catch (_error) {
      return window.location.hash.slice(1).trim()
    }
  }

  function announce(message) {
    liveStatus.textContent = ''
    window.requestAnimationFrame(function () {
      liveStatus.textContent = message
    })
  }

  function updateHistory(code, mode) {
    var url = new URL(window.location.href)
    url.hash = code ? encodeURIComponent(code) : ''
    if (mode === 'replace') window.history.replaceState(null, '', url)
    else window.history.pushState(null, '', url)
  }

  function closeDrawer(restoreFocus) {
    if (!state.drawerCode) return
    state.drawerCode = ''
    drawer.hidden = true
    drawerBackdrop.hidden = true
    appShell.inert = false
    if (restoreFocus && state.returnFocusCode) {
      var trigger = document.querySelector(
        '[data-l3-code="' + CSS.escape(state.returnFocusCode) + '"]',
      )
      if (trigger) trigger.focus()
    }
  }

  function setSelection(node, shouldFocus) {
    closeDrawer(false)
    state.invalidHash = ''
    state.activeDomain = node.domain.code
    state.selectedCode = node.code
    state.selectedKind = node.kind
    state.selectedLevel = null
    if (node.group) state.expanded[node.domain.code].add(node.group.code)
    render()
    if (shouldFocus) focusSelection(node)
  }

  function selectCode(code, options) {
    var node = findNode(code)
    if (!node) return false
    if (options && options.history) updateHistory(code, options.history)
    setSelection(node, !options || options.focus !== false)
    announce(KIND_LABEL[node.kind] + ' ' + node.code + ' 已定位，地址已同步。')
    return true
  }

  function focusSelection(node) {
    window.requestAnimationFrame(function () {
      var target
      if (node.kind === 'L1') target = domainContent
      if (node.kind === 'L2') {
        target = document.querySelector(
          '[data-l2-code="' + CSS.escape(node.code) + '"]',
        )
      }
      if (node.kind === 'L3') {
        target = document.querySelector(
          '[data-l3-code="' + CSS.escape(node.code) + '"]',
        )
      }
      if (target) {
        target.focus()
        target.scrollIntoView({ block: 'nearest' })
      }
    })
  }

  function applyLocation(shouldFocus) {
    var code = currentHash()
    if (!code) {
      closeDrawer(false)
      state.invalidHash = ''
      state.activeDomain = 'P01'
      state.selectedCode = ''
      state.selectedKind = ''
      state.selectedLevel = null
      render()
      if (shouldFocus) domainContent.focus()
      return
    }

    var node = findNode(code)
    if (node) {
      setSelection(node, shouldFocus)
      return
    }

    closeDrawer(false)
    state.selectedCode = ''
    state.selectedKind = ''
    state.selectedLevel = null
    state.invalidHash = code
    var prefix = code.split('.')[0]
    state.activeDomain = domainByCode(prefix) ? prefix : ''
    render()
    if (shouldFocus) {
      if (state.activeDomain) pathError.focus()
      else notFound.focus()
    }
    announce('未找到能力路径 ' + code + '。')
  }

  function renderTabs() {
    tabs.innerHTML = data
      .map(function (domain) {
        var selected = state.activeDomain === domain.code && !(
          state.invalidHash && !state.activeDomain
        )
        return (
          '<button class="domain-tab" type="button" role="tab" ' +
          'aria-selected="' +
          String(selected) +
          '" data-domain-code="' +
          escapeHtml(domain.code) +
          '">' +
          '<strong>' +
          escapeHtml(domain.code) +
          '</strong>' +
          '<span>' +
          escapeHtml(domain.name) +
          '</span>' +
          '<small>' +
          domain.l2Count +
          ' 个 L2 · ' +
          domain.l3Count +
          ' 个 L3</small></button>'
        )
      })
      .join('')

    tabs.querySelectorAll('[data-domain-code]').forEach(function (button) {
      button.addEventListener('click', function () {
        selectCode(button.dataset.domainCode, { history: 'push' })
      })
      button.addEventListener('keydown', function (event) {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        var buttons = Array.from(tabs.querySelectorAll('[data-domain-code]'))
        var current = buttons.indexOf(button)
        var next = current
        if (event.key === 'ArrowLeft') next = (current - 1 + buttons.length) % buttons.length
        if (event.key === 'ArrowRight') next = (current + 1) % buttons.length
        if (event.key === 'Home') next = 0
        if (event.key === 'End') next = buttons.length - 1
        buttons[next].focus()
      })
    })
  }

  function levelMarkup(group) {
    var cards = LEVELS.map(function (level) {
      var detail = group.levels[level]
      var active =
        state.selectedLevel &&
        state.selectedLevel.code === group.code &&
        state.selectedLevel.level === level
      return (
        '<button class="level-card" type="button" aria-pressed="' +
        String(Boolean(active)) +
        '" data-level-code="' +
        escapeHtml(group.code) +
        '" data-level="' +
        level +
        '">' +
        '<strong>' +
        level +
        '</strong><span>' +
        escapeHtml(detail.summary) +
        '</span></button>'
      )
    }).join('')

    var selected =
      state.selectedLevel && state.selectedLevel.code === group.code
        ? state.selectedLevel.level
        : ''
    var description = selected
      ? '<div class="inline-level-description" role="region" aria-live="polite">' +
        '<strong>' +
        selected +
        ' 完整职级要求</strong><p>' +
        escapeHtml(group.levels[selected].full) +
        '</p></div>'
      : ''

    return (
      '<section class="level-section" aria-label="' +
      escapeHtml(group.code) +
      ' 职级要求">' +
      '<h4>职级要求 P4–P8</h4><div class="level-grid">' +
      cards +
      '</div>' +
      description +
      '</section>'
    )
  }

  function pathMarkup(path) {
    var selected = state.selectedCode === path.code
    return (
      '<button class="l3-row' +
      (selected ? ' selected' : '') +
      '" type="button" data-l3-code="' +
      escapeHtml(path.code) +
      '" aria-current="' +
      (selected ? 'location' : 'false') +
      '">' +
      '<span class="name"><strong>' +
      escapeHtml(path.code) +
      ' · ' +
      escapeHtml(path.name) +
      '</strong><span>达成路径 / 学习实践项</span></span>' +
      '<span class="meta">建议起始职级：' +
      escapeHtml(path.startLevel) +
      '<br />预计时长：' +
      escapeHtml(path.hours) +
      ' · 查看详情</span></button>'
    )
  }

  function groupMarkup(group) {
    var open = state.expanded[state.activeDomain].has(group.code)
    var selected =
      state.selectedCode === group.code ||
      state.selectedCode.indexOf(group.code + '.') === 0
    var expanded = ''
    if (open) {
      var paths = group.children.length
        ? '<section class="l3-list" aria-label="' +
          escapeHtml(group.code) +
          ' 达成路径"><h4>达成路径 / 学习实践项</h4>' +
          group.children.map(pathMarkup).join('') +
          '</section>'
        : '<p class="empty-l3" role="status">三级达成路径待补充，当前没有可打开的学习实践项。</p>'
      expanded =
        '<div class="l2-expanded">' + levelMarkup(group) + paths + '</div>'
    }

    return (
      '<section class="l2-group' +
      (selected ? ' selected' : '') +
      '" id="l2-' +
      escapeHtml(group.code) +
      '">' +
      '<button class="l2-toggle" type="button" data-l2-code="' +
      escapeHtml(group.code) +
      '" aria-expanded="' +
      String(open) +
      '">' +
      '<span class="action-label">' +
      (open ? '收起' : '展开') +
      '</span><strong>' +
      escapeHtml(group.code) +
      ' · ' +
      escapeHtml(group.name) +
      '</strong><small>能力标准 · ' +
      group.count +
      ' 条达成路径</small></button>' +
      expanded +
      '</section>'
    )
  }

  function renderContent() {
    var domain = domainByCode(state.activeDomain)
    var unknownPath = Boolean(state.invalidHash && !domain)
    domainContent.hidden = unknownPath
    notFound.hidden = !unknownPath

    if (!domain) return

    domainTitle.textContent = domain.code + ' ' + domain.name
    domainOverviewCopy.textContent = domain.overview
    domainOverviewCounts.textContent =
      domain.l2Count + ' 个能力标准 · ' + domain.l3Count + ' 个达成路径'
    l2Count.textContent = domain.l2Count + ' 个 L2 能力组'
    l2List.innerHTML = domain.groups.map(groupMarkup).join('')

    l2List.querySelectorAll('[data-l2-code]').forEach(function (button) {
      button.addEventListener('click', function () {
        var code = button.dataset.l2Code
        var open = button.getAttribute('aria-expanded') === 'true'
        if (open) {
          state.expanded[state.activeDomain].delete(code)
          if (
            state.selectedCode === code ||
            state.selectedCode.indexOf(code + '.') === 0
          ) {
            selectCode(state.activeDomain, { history: 'push' })
            return
          }
          render()
          button = document.querySelector(
            '[data-l2-code="' + CSS.escape(code) + '"]',
          )
          if (button) button.focus()
          return
        }
        selectCode(code, { history: 'push' })
      })
    })

    l2List.querySelectorAll('[data-level-code]').forEach(function (button) {
      button.addEventListener('click', function () {
        var level = button.dataset.level
        var code = button.dataset.levelCode
        var same =
          state.selectedLevel &&
          state.selectedLevel.code === code &&
          state.selectedLevel.level === level
        state.selectedLevel = same ? null : { code: code, level: level }
        render()
        var updated = document.querySelector(
          '[data-level-code="' +
            CSS.escape(code) +
            '"][data-level="' +
            CSS.escape(level) +
            '"]',
        )
        if (updated) updated.focus()
      })
    })

    l2List.querySelectorAll('[data-l3-code]').forEach(function (button) {
      button.addEventListener('click', function () {
        var code = button.dataset.l3Code
        selectCode(code, { history: 'push', focus: false })
        openDrawer(code)
      })
    })
  }

  function renderError() {
    pathError.hidden = !state.invalidHash
    if (!state.invalidHash) return
    if (state.activeDomain) {
      pathErrorCopy.textContent =
        '“' +
        state.invalidHash +
        '”不在当前模型中。已保留可识别的 ' +
        state.activeDomain +
        ' 能力域上下文，但没有冒充任何 L2 或 L3 已选中。'
    } else {
      pathErrorCopy.textContent =
        '“' +
        state.invalidHash +
        '”无法识别。页面没有静默回退到 P01，也没有改写这个问题链接。'
    }
  }

  function render() {
    renderTabs()
    renderError()
    renderContent()
  }

  function resultContext(result) {
    if (result.kind === 'L1') return '能力域概览'
    if (result.kind === 'L2') {
      return result.domain.code + ' · ' + result.domain.name
    }
    return (
      result.domain.code +
      ' · ' +
      result.domain.name +
      ' / ' +
      result.group.code +
      ' · ' +
      result.group.name
    )
  }

  function renderSearchResults() {
    var query = searchInput.value.trim().toLocaleLowerCase()
    clearSearch.hidden = !query
    if (!query || !state.searchOpen) {
      searchResultsElement.hidden = true
      searchInput.setAttribute('aria-expanded', 'false')
      searchInput.removeAttribute('aria-activedescendant')
      return
    }

    state.searchResults = index
      .filter(function (result) {
        return (
          result.code.toLocaleLowerCase().includes(query) ||
          result.name.toLocaleLowerCase().includes(query)
        )
      })
      .slice(0, 30)

    if (
      state.activeSearchIndex < 0 ||
      state.activeSearchIndex >= state.searchResults.length
    ) {
      state.activeSearchIndex = state.searchResults.length ? 0 : -1
    }

    if (!state.searchResults.length) {
      searchResultsElement.innerHTML =
        '<p class="empty-search" role="status">未找到 L1、L2 或 L3 编号/名称。请检查输入或清除搜索。</p>'
      searchInput.removeAttribute('aria-activedescendant')
    } else {
      searchResultsElement.innerHTML = state.searchResults
        .map(function (result, indexNumber) {
          var active = state.activeSearchIndex === indexNumber
          return (
            '<button class="search-option' +
            (active ? ' active' : '') +
            '" id="search-option-' +
            indexNumber +
            '" type="button" role="option" tabindex="-1" aria-selected="' +
            String(active) +
            '" data-result-index="' +
            indexNumber +
            '">' +
            '<span class="kind">' +
            KIND_LABEL[result.kind] +
            '</span><span class="result-name"><strong>' +
            escapeHtml(result.code) +
            '</strong> · ' +
            escapeHtml(result.name) +
            '</span><small>' +
            escapeHtml(resultContext(result)) +
            '</small></button>'
          )
        })
        .join('')
      searchInput.setAttribute(
        'aria-activedescendant',
        'search-option-' + state.activeSearchIndex,
      )
      searchResultsElement
        .querySelectorAll('[data-result-index]')
        .forEach(function (button) {
          button.addEventListener('mousedown', function (event) {
            event.preventDefault()
          })
          button.addEventListener('click', function () {
            chooseSearchResult(Number(button.dataset.resultIndex))
          })
        })
    }

    searchResultsElement.hidden = false
    searchInput.setAttribute('aria-expanded', 'true')
    var activeOption = document.querySelector(
      '#search-option-' + state.activeSearchIndex,
    )
    if (activeOption) activeOption.scrollIntoView({ block: 'nearest' })
  }

  function chooseSearchResult(indexNumber) {
    var result = state.searchResults[indexNumber]
    if (!result) return
    state.searchOpen = false
    state.activeSearchIndex = -1
    renderSearchResults()
    selectCode(result.code, { history: 'push' })
  }

  function moveSearch(delta) {
    if (!state.searchResults.length) return
    state.activeSearchIndex =
      (state.activeSearchIndex + delta + state.searchResults.length) %
      state.searchResults.length
    renderSearchResults()
  }

  function openDrawer(code) {
    var node = findNode(code)
    if (!node || node.kind !== 'L3') return
    state.drawerCode = code
    state.returnFocusCode = code
    drawerTitle.textContent = node.path.code
    drawerName.textContent = node.path.name
    drawerBody.innerHTML =
      '<dl class="detail-grid">' +
      '<div><dt>所属能力域</dt><dd>' +
      escapeHtml(node.domain.code + ' · ' + node.domain.name) +
      '</dd></div>' +
      '<div><dt>所属能力组</dt><dd>' +
      escapeHtml(node.group.code + ' · ' + node.group.name) +
      '</dd></div>' +
      '<div><dt>达成路径</dt><dd>' +
      escapeHtml(node.path.code + ' · ' + node.path.name) +
      '</dd></div>' +
      '<div><dt>建议起始职级</dt><dd>' +
      escapeHtml(node.path.startLevel) +
      '</dd></div>' +
      '<div><dt>预期输出 / 验收方式</dt><dd>' +
      escapeHtml(node.path.output) +
      '</dd></div>' +
      '<div><dt>预计时长</dt><dd>' +
      escapeHtml(node.path.hours) +
      '</dd></div></dl>' +
      '<section class="drawer-section"><h3>材料与资源</h3><p>' +
      escapeHtml(node.path.resources) +
      '</p></section>' +
      '<section class="drawer-section"><h3>当前已发布职级标准</h3>' +
      '<p>Capability Standard Baseline v1 · Member 目标职级 P5</p>' +
      '<div class="mastery-grid">' +
      LEVELS.map(function (level, indexNumber) {
        return (
          '<div class="' +
          (level === 'P5' ? 'target' : '') +
          '"><strong>' +
          level +
          '</strong><span>目标掌握度 ' +
          Math.min(indexNumber + 1, 5) +
          ' / 5</span></div>'
        )
      }).join('') +
      '</div></section>'
    drawer.hidden = false
    drawerBackdrop.hidden = false
    appShell.inert = true
    window.requestAnimationFrame(function () {
      drawer.focus()
    })
  }

  function drawerKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeDrawer(true)
      return
    }
    if (event.key !== 'Tab') return
    var focusable = Array.from(
      drawer.querySelectorAll('button:not([disabled]), [href], input:not([disabled])'),
    )
    if (!focusable.length) {
      event.preventDefault()
      drawer.focus()
      return
    }
    var first = focusable[0]
    var last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  searchInput.addEventListener('input', function () {
    state.searchOpen = Boolean(searchInput.value.trim())
    state.activeSearchIndex = 0
    renderSearchResults()
  })

  searchInput.addEventListener('focus', function () {
    if (searchInput.value.trim()) {
      state.searchOpen = true
      renderSearchResults()
    }
  })

  searchInput.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!state.searchOpen) state.searchOpen = true
      renderSearchResults()
      moveSearch(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!state.searchOpen) state.searchOpen = true
      renderSearchResults()
      moveSearch(-1)
    } else if (event.key === 'Home' && state.searchOpen) {
      event.preventDefault()
      state.activeSearchIndex = 0
      renderSearchResults()
    } else if (event.key === 'End' && state.searchOpen) {
      event.preventDefault()
      state.activeSearchIndex = Math.max(0, state.searchResults.length - 1)
      renderSearchResults()
    } else if (event.key === 'Enter' && state.searchOpen) {
      event.preventDefault()
      chooseSearchResult(state.activeSearchIndex)
    } else if (event.key === 'Escape' && state.searchOpen) {
      event.preventDefault()
      state.searchOpen = false
      state.activeSearchIndex = -1
      renderSearchResults()
      announce('搜索结果已关闭，查询内容保留。')
    }
  })

  clearSearch.addEventListener('click', function () {
    searchInput.value = ''
    state.searchOpen = false
    state.activeSearchIndex = -1
    state.searchResults = []
    renderSearchResults()
    searchInput.focus()
    announce('搜索已清除，当前能力路径保持不变。')
  })

  document.querySelector('#expand-domain').addEventListener('click', function () {
    var domain = domainByCode(state.activeDomain)
    if (!domain) return
    state.expanded[domain.code] = new Set(
      domain.groups.map(function (group) {
        return group.code
      }),
    )
    render()
    announce(domain.code + ' 的能力组已全部展开。')
  })

  document.querySelector('#collapse-domain').addEventListener('click', function () {
    var domain = domainByCode(state.activeDomain)
    if (!domain) return
    state.expanded[domain.code] = new Set()
    if (
      state.selectedKind === 'L2' ||
      state.selectedKind === 'L3'
    ) {
      selectCode(domain.code, { history: 'push' })
      return
    }
    render()
    domainContent.focus()
    announce(domain.code + ' 的能力组已全部收起。')
  })

  document
    .querySelector('#reset-invalid-path')
    .addEventListener('click', function () {
      updateHistory('', 'replace')
      applyLocation(true)
      announce('无效路径已清除，已返回 P01 能力域。')
    })

  drawer.querySelector('.drawer-close').addEventListener('click', function () {
    closeDrawer(true)
  })
  drawerBackdrop.addEventListener('click', function () {
    closeDrawer(true)
  })
  drawer.addEventListener('keydown', drawerKeydown)

  document.querySelectorAll('.sidebar a:not(.active)').forEach(function (link) {
    link.addEventListener('click', function (event) {
      event.preventDefault()
      announce('阶段 1 原型只演示能力地图，不跳转其他页面。')
    })
  })

  window.addEventListener('popstate', function () {
    applyLocation(true)
  })
  window.addEventListener('hashchange', function () {
    applyLocation(true)
  })

  applyLocation(false)
  renderSearchResults()
})()
