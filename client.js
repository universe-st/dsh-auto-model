/**
 * Auto model (切模插件) Client half.
 *
 * Two contributions:
 * - `plugins.row.config`: the configuration page for the `auto-model` row. It
 *   edits the plugin's volatile routing document through the owner's config
 *   form, with drag-and-drop rule priority.
 * - `sidebar.session.row.hover`: a user-only line naming the real model that
 *   currently answers for that Session, read from the Host projection.
 */

window.__ModuleLoader__.load({
  id: 'dsh-auto-model',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'autoModel'
    const PACKAGE_NAME = 'dsh-auto-model'
    const ROW_ID = 'auto-model'
    const PROVIDER_ID = 'auto-model'
    const PREFIX = 'dsh-auto-model'

    /** Apply-time services and the bound translate, for components rendered outside a locale seat. */
    const binding = { remote: null, translate: key => key }

    const cls = (...names) => names.filter(Boolean).join(' ')

    /** Strip UI-only shape so the document written to the Host is plain JSON. */
    const plain = value => JSON.parse(JSON.stringify(value ?? null))

    const uid = () => `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

    /** `datetime-local` value for a Date in the browser's own zone. */
    const localDateTime = (date) => {
      const pad = value => String(value).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    const RULE_KINDS = [
      'time-of-day',
      'datetime-range',
      'first-message-keyword',
      'recent-message-keyword',
      'image-attempt',
      'command',
      'recent-failure',
    ]

    const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

    const en = {
      'meta.title': 'Auto model',
      'meta.description': 'Route every request of a virtual model to a real model chosen by ordered switching rules.',
      'panel.title': 'Virtual models',
      'panel.intro': 'A virtual model is listed under the provider 切模插件. Requests are forwarded to a real model picked by the first matching rule; the fallback answers when nothing matches.',
      'panel.empty': 'No virtual model yet. Add one to get started.',
      'panel.addModel': 'Add virtual model',
      'panel.settings': 'Router settings',
      'panel.retryBudget': 'Retry budget per target (ms)',
      'panel.retryBudgetHint': 'Stop retrying one target after this long and switch. 0 means no limit.',
      'panel.maxSwitches': 'Maximum switches per request',
      'panel.commandTimeout': 'Command probe timeout (ms)',
      'panel.logRouting': 'Log routing decisions',
      'panel.save': 'Save',
      'panel.reset': 'Discard changes',
      'panel.dirty': 'Unsaved changes',
      'panel.saved': 'Saved.',
      'panel.refused': 'The Host refused the change.',
      'panel.loading': 'Loading configuration…',
      'panel.unavailable': 'This deployment does not accept configuration writes here.',
      'panel.problems': 'Fix these before saving:',
      'model.title': 'Virtual model',
      'model.id': 'Model id',
      'model.idHint': 'Shown after auto-model/ in the selector. No spaces or slashes.',
      'model.name': 'Display name',
      'model.description': 'Description',
      'model.fallback': 'Fallback model',
      'model.fallbackHint': 'Used when no rule matches, and as the last resort after failed targets.',
      'model.capability': 'Capability reference',
      'model.capabilityHint': 'Context window, output cap, reasoning levels and image support are read from this model. Defaults to the fallback model.',
      'model.capabilityFollow': 'Follow the fallback model',
      'model.remove': 'Delete model',
      'model.confirmRemove': 'Delete this virtual model and its rules?',
      'rules.title': 'Rules (top wins)',
      'rules.empty': 'No rule yet: every request uses the fallback model.',
      'rules.add': 'Add rule',
      'rules.drag': 'Drag to reorder',
      'rules.moveUp': 'Move up',
      'rules.moveDown': 'Move down',
      'rules.remove': 'Delete rule',
      'rules.enabled': 'Enabled',
      'rules.target': 'Use this model',
      'rules.hit': 'when',
      'target.placeholder': 'Select a model',
      'target.custom': 'Custom provider / model…',
      'target.provider': 'Provider id',
      'target.model': 'Model id',
      'kind.time-of-day': 'Daily time range',
      'kind.datetime-range': 'Date and time range',
      'kind.first-message-keyword': 'First user message contains keyword',
      'kind.recent-message-keyword': 'Recent user messages contain keyword',
      'kind.image-attempt': 'Image attempt',
      'kind.command': 'Command returns a value',
      'kind.recent-failure': 'Recent failure of the current model',
      'kind.time-of-day.hint': 'Compare the request clock with a daily range.',
      'kind.datetime-range.hint': 'Compare the request time with two dates.',
      'kind.first-message-keyword.hint': 'The first user message of the conversation.',
      'kind.recent-message-keyword.hint': 'The last N user messages.',
      'kind.image-attempt.hint': 'An image is attached, or the history calls an image-viewing tool.',
      'kind.command.hint': 'Run one shell command and compare its output; results are cached.',
      'kind.recent-failure.hint': 'The model currently in use failed within the window, after automatic retries.',
      'field.from': 'From',
      'field.to': 'To',
      'field.days': 'Weekdays',
      'field.timeZone': 'Time zone (IANA, optional)',
      'field.keywords': 'Keywords (comma separated)',
      'field.caseSensitive': 'Case sensitive',
      'field.count': 'How many recent messages',
      'field.toolNames': 'Image tool names (comma separated, optional)',
      'field.command': 'Command',
      'field.expected': 'Expected value',
      'field.matchMode': 'Compare as',
      'field.cacheSeconds': 'Cache seconds',
      'field.timeoutMs': 'Timeout milliseconds (optional)',
      'field.cwd': 'Working directory (optional)',
      'field.hours': 'Hours',
      'field.codes': 'Failure codes (comma separated, empty means any)',
      'match.equals': 'equals',
      'match.contains': 'contains',
      'match.regex': 'regular expression',
      'match.not-equals': 'not equals',
      'weekday.1': 'Mon',
      'weekday.2': 'Tue',
      'weekday.3': 'Wed',
      'weekday.4': 'Thu',
      'weekday.5': 'Fri',
      'weekday.6': 'Sat',
      'weekday.7': 'Sun',
      'summary.models': '{models} virtual model(s), {rules} rule(s)',
      'problem.noModels': 'Add at least one virtual model.',
      'problem.modelId': 'Every virtual model needs an id without spaces or slashes.',
      'problem.modelIdDuplicate': 'Virtual model id "{id}" is used twice.',
      'problem.fallback': 'Virtual model "{id}" needs a fallback model.',
      'problem.ruleTarget': 'Rule {index} of "{id}" needs a target model.',
      'problem.ruleKeywords': 'Rule {index} of "{id}" needs at least one keyword.',
      'problem.ruleCommand': 'Rule {index} of "{id}" needs a command.',
      'problem.ruleClock': 'Rule {index} of "{id}" needs a valid from/to time.',
      'problem.ruleZone': 'Rule {index} of "{id}" has an unknown time zone.',
      'problem.ruleDates': 'Rule {index} of "{id}" needs a valid from/to date.',
      'problem.targetSelf': '"{id}" cannot forward to the auto-model provider itself.',
      'hint.label': 'Real model',
      'hint.virtual': 'Virtual',
    }

    const zh = {
      'meta.title': '切模插件',
      'meta.description': '把自切模型的每次请求转给由切换规则选出的真实模型。',
      'panel.title': '自切模型',
      'panel.intro': '自切模型会出现在提供商标识「切模插件」下。请求会转发给优先级最高的命中规则所指定的真实模型；都没有命中时使用兜底模型。',
      'panel.empty': '还没有自切模型，先添加一个。',
      'panel.addModel': '添加自切模型',
      'panel.settings': '路由设置',
      'panel.retryBudget': '单个目标的重试预算（毫秒）',
      'panel.retryBudgetHint': '超过该时长就不再重试当前模型，直接切换。0 表示不限制。',
      'panel.maxSwitches': '单次请求最多切换次数',
      'panel.commandTimeout': '命令探测超时（毫秒）',
      'panel.logRouting': '记录路由决策日志',
      'panel.save': '保存',
      'panel.reset': '放弃修改',
      'panel.dirty': '有未保存的修改',
      'panel.saved': '已保存。',
      'panel.refused': 'Host 拒绝了这次修改。',
      'panel.loading': '正在读取配置……',
      'panel.unavailable': '当前部署不接受在此写入配置。',
      'panel.problems': '保存前请先处理：',
      'model.title': '自切模型',
      'model.id': '模型 ID',
      'model.idHint': '在模型选择器中显示为 auto-model/ID。不能包含空格或斜杠。',
      'model.name': '显示名称',
      'model.description': '描述',
      'model.fallback': '兜底模型',
      'model.fallbackHint': '没有命中任何规则时使用，也是所有目标失败后的最后兜底。',
      'model.capability': '能力参考模型',
      'model.capabilityHint': '上下文窗口、输出上限、推理档位与图片支持都取自该模型，默认跟随兜底模型。',
      'model.capabilityFollow': '跟随兜底模型',
      'model.remove': '删除模型',
      'model.confirmRemove': '删除这个自切模型及其全部规则？',
      'rules.title': '规则（越靠上优先级越高）',
      'rules.empty': '还没有规则：所有请求都走兜底模型。',
      'rules.add': '添加规则',
      'rules.drag': '拖动可调整优先级',
      'rules.moveUp': '上移',
      'rules.moveDown': '下移',
      'rules.remove': '删除规则',
      'rules.enabled': '启用',
      'rules.target': '使用模型',
      'rules.hit': '当',
      'target.placeholder': '选择一个模型',
      'target.custom': '自定义提供商 / 模型……',
      'target.provider': '提供商 ID',
      'target.model': '模型 ID',
      'kind.time-of-day': '单日时间范围',
      'kind.datetime-range': '跨天日期时间范围',
      'kind.first-message-keyword': '会话首个用户对话包含关键字',
      'kind.recent-message-keyword': '最近若干用户对话包含关键字',
      'kind.image-attempt': '试图识图',
      'kind.command': '执行命令得到特定值',
      'kind.recent-failure': '当前模型近期请求失败',
      'kind.time-of-day.hint': '用请求时间与每日时间范围比较。',
      'kind.datetime-range.hint': '用请求时间与两个日期时间比较。',
      'kind.first-message-keyword.hint': '只检查会话里的第一条用户消息。',
      'kind.recent-message-keyword.hint': '检查最近 N 条用户消息。',
      'kind.image-attempt.hint': '消息里有图片，或历史中调用过识图工具。',
      'kind.command.hint': '执行一条命令并比对输出，结果会缓存。',
      'kind.recent-failure.hint': '当前使用的模型在时间窗口内失败过（自动重试之后）。',
      'field.from': '开始',
      'field.to': '结束',
      'field.days': '星期几',
      'field.timeZone': '时区（IANA，可选）',
      'field.keywords': '关键字（逗号分隔）',
      'field.caseSensitive': '区分大小写',
      'field.count': '最近几条消息',
      'field.toolNames': '识图工具名（逗号分隔，可选）',
      'field.command': '命令',
      'field.expected': '期望值',
      'field.matchMode': '比较方式',
      'field.cacheSeconds': '缓存秒数',
      'field.timeoutMs': '超时毫秒（可选）',
      'field.cwd': '工作目录（可选）',
      'field.hours': '小时数',
      'field.codes': '失败码（逗号分隔，留空表示任意）',
      'match.equals': '等于',
      'match.contains': '包含',
      'match.regex': '正则匹配',
      'match.not-equals': '不等于',
      'weekday.1': '一',
      'weekday.2': '二',
      'weekday.3': '三',
      'weekday.4': '四',
      'weekday.5': '五',
      'weekday.6': '六',
      'weekday.7': '日',
      'summary.models': '{models} 个自切模型，{rules} 条规则',
      'problem.noModels': '至少添加一个自切模型。',
      'problem.modelId': '每个自切模型都需要一个不含空格或斜杠的 ID。',
      'problem.modelIdDuplicate': '自切模型 ID “{id}” 重复了。',
      'problem.fallback': '自切模型“{id}”需要设置兜底模型。',
      'problem.ruleTarget': '“{id}”的第 {index} 条规则还没有选择目标模型。',
      'problem.ruleKeywords': '“{id}”的第 {index} 条规则至少需要一个关键字。',
      'problem.ruleCommand': '“{id}”的第 {index} 条规则需要填写命令。',
      'problem.ruleClock': '“{id}”的第 {index} 条规则需要合法的开始/结束时间。',
      'problem.ruleZone': '“{id}”的第 {index} 条规则填写了无法识别的时区。',
      'problem.ruleDates': '“{id}”的第 {index} 条规则需要合法的开始/结束日期。',
      'problem.targetSelf': '“{id}”不能把请求转给「切模插件」这个提供商本身。',
      'hint.label': '真实模型',
      'hint.virtual': '自切',
    }

    const STYLE_ID = `${PREFIX}-styles`

    const styles = `
.${PREFIX}-root { display: flex; flex-direction: column; gap: 14px; font-size: 13px; color: var(--dsw-alias-label-primary); }
.${PREFIX}-intro { margin: 0; color: var(--dsw-alias-label-secondary); line-height: 1.6; }
.${PREFIX}-section { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.${PREFIX}-sectionHead { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.${PREFIX}-sectionTitle { margin: 0; font-size: 14px; font-weight: 600; }
.${PREFIX}-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.${PREFIX}-cardHead { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.${PREFIX}-cardTitle { font-size: 13px; font-weight: 600; }
.${PREFIX}-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
.${PREFIX}-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.${PREFIX}-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.${PREFIX}-hintText { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.5; margin: 0; }
.${PREFIX}-input, .${PREFIX}-select, .${PREFIX}-textarea { box-sizing: border-box; width: 100%; min-height: 30px; padding: 4px 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; }
.${PREFIX}-textarea { min-height: 60px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.${PREFIX}-input:focus, .${PREFIX}-select:focus, .${PREFIX}-textarea:focus { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 0; }
.${PREFIX}-button { min-height: 30px; padding: 4px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer; }
.${PREFIX}-button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-1); }
.${PREFIX}-button:disabled { opacity: .5; cursor: default; }
.${PREFIX}-buttonPrimary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: #fff; }
.${PREFIX}-buttonPrimary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); opacity: .9; }
.${PREFIX}-buttonGhost { background: transparent; border-color: transparent; color: var(--dsw-alias-label-secondary); }
.${PREFIX}-buttonGhost:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.${PREFIX}-buttonDanger { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-border-l1); background: transparent; }
.${PREFIX}-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.${PREFIX}-spacer { flex: 1 1 auto; }
.${PREFIX}-status { font-size: 12px; }
.${PREFIX}-statusOk { color: var(--dsw-alias-state-success-primary); }
.${PREFIX}-statusError { color: var(--dsw-alias-state-error-primary); }
.${PREFIX}-problems { margin: 0; padding-left: 18px; color: var(--dsw-alias-state-error-primary); font-size: 12px; display: flex; flex-direction: column; gap: 3px; }
.${PREFIX}-badge { display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border-radius: 999px; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 11px; }
.${PREFIX}-badgeWarn { color: var(--dsw-alias-state-warn-primary); }
.${PREFIX}-rules { display: flex; flex-direction: column; gap: 8px; }
.${PREFIX}-rule { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base); }
.${PREFIX}-ruleOver { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 1px var(--dsw-alias-brand-primary) inset; }
.${PREFIX}-ruleDragging { opacity: .5; }
.${PREFIX}-ruleHead { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: grab; }
.${PREFIX}-ruleHead:active { cursor: grabbing; }
.${PREFIX}-ruleTitle { font-weight: 600; font-size: 12.5px; }
.${PREFIX}-ruleBody { padding: 0 10px 10px; display: flex; flex-direction: column; gap: 10px; }
.${PREFIX}-ruleTarget { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.${PREFIX}-handle { color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 1; letter-spacing: 1px; user-select: none; }
.${PREFIX}-checkbox { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.${PREFIX}-days { display: flex; gap: 6px; flex-wrap: wrap; }
.${PREFIX}-dayChip { padding: 3px 8px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.${PREFIX}-dayChipOn { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: #fff; }
.${PREFIX}-hint { display: flex; align-items: baseline; gap: 6px; font-size: 11.5px; line-height: 1.5; color: var(--dsw-alias-label-secondary); max-width: 260px; }
.${PREFIX}-hintLabel { flex: none; color: var(--dsw-alias-label-secondary); opacity: .8; }
.${PREFIX}-hintValue { color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${PREFIX}-hintArrow { color: var(--dsw-alias-label-secondary); }
`

    function Styles() {
      return h('style', { 'data-dsh-plugin': PACKAGE_NAME }, styles)
    }

    function Field({ label, hint, children }) {
      return h('label', { className: `${PREFIX}-field` },
        label === undefined ? null : h('span', { className: `${PREFIX}-label` }, label),
        children,
        hint === undefined ? null : h('span', { className: `${PREFIX}-hintText` }, hint))
    }

    function TextInput({ value, onChange, placeholder, mono, disabled, id }) {
      return h('input', {
        id,
        className: mono ? `${PREFIX}-input ${PREFIX}-textarea` : `${PREFIX}-input`,
        type: 'text',
        value: value ?? '',
        placeholder,
        disabled,
        onChange: event => onChange(event.target.value),
      })
    }

    function NumberInput({ value, onChange, min, step }) {
      return h('input', {
        className: `${PREFIX}-input`,
        type: 'number',
        value: value === undefined || value === null ? '' : value,
        min,
        step: step ?? 1,
        onChange: (event) => {
          const next = event.target.value
          onChange(next === '' ? undefined : Number(next))
        },
      })
    }

    function Checkbox({ checked, onChange, label }) {
      return h('label', { className: `${PREFIX}-checkbox` },
        h('input', { type: 'checkbox', checked: checked === true, onChange: event => onChange(event.target.checked) }),
        label)
    }

    function Select({ value, onChange, children }) {
      return h('select', { className: `${PREFIX}-select`, value, onChange: event => onChange(event.target.value) }, children)
    }

    function Button({ children, onClick, disabled, kind, title }) {
      return h('button', {
        type: 'button',
        title,
        className: cls(`${PREFIX}-button`, kind === 'primary' && `${PREFIX}-buttonPrimary`, kind === 'ghost' && `${PREFIX}-buttonGhost`, kind === 'danger' && `${PREFIX}-buttonDanger`),
        disabled: disabled === true,
        onClick,
      }, children)
    }

    /** One `{provider, model}` target: a catalog picker with a manual escape hatch. */
    function TargetPicker({ value, groups, t, onChange, allowEmpty }) {
      const target = value !== null && typeof value === 'object' && typeof value.provider === 'string' && value.provider.length > 0
        ? value
        : null
      const key = target === null ? '' : `${target.provider}/${target.model}`
      const options = []
      for (const group of groups) {
        for (const model of group.models) {
          options.push({
            key: `${group.id}/${model.id}`,
            label: `${group.name} · ${model.name}`,
            value: { provider: group.id, model: model.id },
          })
        }
      }
      const known = options.some(option => option.key === key)
      // Manual entry is an explicit choice: the catalog may still be loading on
      // first render, so deriving it from "unknown target" would flash open.
      const [manual, setManual] = React.useState(false)

      const selected = manual ? '__manual__' : (known ? key : (target === null ? '' : '__current__'))
      const select = h(Select, {
        value: selected,
        onChange: (next) => {
          if (next === '__manual__') {
            setManual(true)
            onChange({ provider: target?.provider ?? '', model: target?.model ?? '' })
            return
          }
          setManual(false)
          if (next === '') {
            onChange(null)
            return
          }
          if (next === '__current__') return
          const option = options.find(candidate => candidate.key === next)
          if (option !== undefined) onChange(option.value)
        },
      },
      allowEmpty
        ? h('option', { value: '' }, '—')
        // A required target needs a placeholder: an empty controlled value with
        // no matching option would make the browser display the first model.
        : target === null ? h('option', { value: '', disabled: true }, t('target.placeholder')) : null,
      target !== null && !known
        ? h('option', { value: '__current__' }, `${target.provider}/${target.model} (${t('target.custom')})`)
        : null,
      options.map(option => h('option', { key: option.key, value: option.key }, option.label)),
      h('option', { value: '__manual__' }, t('target.custom')),
      )

      if (!manual) return select
      return h('div', { className: `${PREFIX}-grid` },
        select,
        h(Field, { label: t('target.provider') },
          h(TextInput, {
            value: target?.provider ?? '',
            onChange: next => onChange({ provider: next, model: target?.model ?? '' }),
            mono: true,
          })),
        h(Field, { label: t('target.model') },
          h(TextInput, {
            value: target?.model ?? '',
            onChange: next => onChange({ provider: target?.provider ?? '', model: next }),
            mono: true,
          })))
    }

    const splitList = text => String(text ?? '')
      .split(',')
      .map(part => part.trim())
      .filter(part => part.length > 0)

    function newRule(type) {
      const rule = {
        id: uid(),
        type,
        enabled: true,
        target: { provider: '', model: '' },
      }
      switch (type) {
        case 'time-of-day':
          rule.from = '09:00'
          rule.to = '18:00'
          break
        case 'datetime-range':
          rule.from = localDateTime(new Date())
          rule.to = localDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000))
          break
        case 'first-message-keyword':
        case 'recent-message-keyword':
          rule.keywords = []
          rule.caseSensitive = false
          if (type === 'recent-message-keyword') rule.count = 3
          break
        case 'image-attempt':
          rule.toolNames = []
          break
        case 'command':
          rule.command = ''
          rule.expected = ''
          rule.matchMode = 'equals'
          rule.cacheSeconds = 60
          break
        case 'recent-failure':
          rule.hours = 1
          rule.codes = []
          break
        default:
          break
      }
      return rule
    }

    /** Human-readable one-line description of a rule's condition. */
    function ruleSummary(rule, t) {
      switch (rule.type) {
        case 'time-of-day':
          return `${rule.from ?? ''}–${rule.to ?? ''}${Array.isArray(rule.days) && rule.days.length > 0 ? ` · ${rule.days.map(day => t(`weekday.${day}`)).join(' ')}` : ''}`
        case 'datetime-range':
          return `${String(rule.from ?? '').replace('T', ' ')} – ${String(rule.to ?? '').replace('T', ' ')}`
        case 'first-message-keyword':
        case 'recent-message-keyword':
          return (rule.keywords ?? []).join(', ')
        case 'image-attempt':
          return (rule.toolNames ?? []).join(', ')
        case 'command':
          return rule.command ?? ''
        case 'recent-failure':
          return `${rule.hours}h${Array.isArray(rule.codes) && rule.codes.length > 0 ? ` · ${rule.codes.join(',')}` : ''}`
        default:
          return ''
      }
    }

    /** Fields of one rule, chosen by kind. */
    function RuleFields({ rule, groups, t, onChange }) {
      const patch = next => onChange({ ...rule, ...next })
      switch (rule.type) {
        case 'time-of-day': {
          const days = Array.isArray(rule.days) ? rule.days : []
          return h(React.Fragment, null,
            h('div', { className: `${PREFIX}-grid` },
              h(Field, { label: t('field.from') },
                h('input', {
                  className: `${PREFIX}-input`,
                  type: 'time',
                  value: rule.from ?? '',
                  onChange: event => patch({ from: event.target.value }),
                })),
              h(Field, { label: t('field.to') },
                h('input', {
                  className: `${PREFIX}-input`,
                  type: 'time',
                  value: rule.to ?? '',
                  onChange: event => patch({ to: event.target.value }),
                })),
              h(Field, { label: t('field.timeZone') },
                h(TextInput, { value: rule.timeZone ?? '', onChange: next => patch({ timeZone: next }), placeholder: 'Asia/Shanghai' }))),
            h(Field, { label: t('field.days') },
              h('div', { className: `${PREFIX}-days` },
                WEEKDAYS.map(day => h('button', {
                  key: day,
                  type: 'button',
                  className: cls(`${PREFIX}-dayChip`, days.includes(day) && `${PREFIX}-dayChipOn`),
                  onClick: () => patch({
                    days: days.includes(day) ? days.filter(candidate => candidate !== day) : [...days, day].sort(),
                  }),
                }, t(`weekday.${day}`))))))
        }
        case 'datetime-range':
          return h('div', { className: `${PREFIX}-grid` },
            h(Field, { label: t('field.from') },
              h('input', {
                className: `${PREFIX}-input`,
                type: 'datetime-local',
                value: String(rule.from ?? '').slice(0, 16),
                onChange: event => patch({ from: event.target.value }),
              })),
            h(Field, { label: t('field.to') },
              h('input', {
                className: `${PREFIX}-input`,
                type: 'datetime-local',
                value: String(rule.to ?? '').slice(0, 16),
                onChange: event => patch({ to: event.target.value }),
              })))
        case 'first-message-keyword':
        case 'recent-message-keyword':
          return h(React.Fragment, null,
            h(Field, { label: t('field.keywords') },
              h(TextInput, {
                value: (rule.keywords ?? []).join(', '),
                onChange: next => patch({ keywords: splitList(next) }),
                placeholder: 'debug, 报错',
              })),
            h('div', { className: `${PREFIX}-row` },
              rule.type === 'recent-message-keyword'
                ? h(Field, { label: t('field.count') },
                  h(NumberInput, { value: rule.count ?? 3, min: 1, onChange: next => patch({ count: next }) }))
                : null,
              h(Checkbox, {
                checked: rule.caseSensitive === true,
                onChange: next => patch({ caseSensitive: next }),
                label: t('field.caseSensitive'),
              })))
        case 'image-attempt':
          return h(Field, { label: t('field.toolNames') },
            h(TextInput, {
              value: (rule.toolNames ?? []).join(', '),
              onChange: next => patch({ toolNames: splitList(next) }),
              placeholder: 'read_image, screenshot',
            }))
        case 'command':
          return h(React.Fragment, null,
            h(Field, { label: t('field.command') },
              h('textarea', {
                className: `${PREFIX}-textarea`,
                value: rule.command ?? '',
                onChange: event => patch({ command: event.target.value }),
                placeholder: 'cat ~/.dsh/region',
              })),
            h('div', { className: `${PREFIX}-grid` },
              h(Field, { label: t('field.expected') },
                h(TextInput, { value: rule.expected ?? '', onChange: next => patch({ expected: next }) })),
              h(Field, { label: t('field.matchMode') },
                h(Select, {
                  value: rule.matchMode ?? 'equals',
                  onChange: next => patch({ matchMode: next }),
                }, ['equals', 'contains', 'regex', 'not-equals'].map(mode => h('option', { key: mode, value: mode }, t(`match.${mode}`))))),
              h(Field, { label: t('field.cacheSeconds') },
                h(NumberInput, { value: rule.cacheSeconds ?? 60, min: 0, onChange: next => patch({ cacheSeconds: next }) })),
              h(Field, { label: t('field.timeoutMs') },
                h(NumberInput, { value: rule.timeoutMs, min: 0, onChange: next => patch({ timeoutMs: next }) })),
              h(Field, { label: t('field.cwd') },
                h(TextInput, { value: rule.cwd ?? '', onChange: next => patch({ cwd: next }), placeholder: '/Users/me/project' }))))
        case 'recent-failure':
          return h('div', { className: `${PREFIX}-grid` },
            h(Field, { label: t('field.hours') },
              h(NumberInput, { value: rule.hours ?? 1, min: 0.01, step: 0.5, onChange: next => patch({ hours: next }) })),
            h(Field, { label: t('field.codes') },
              h(TextInput, {
                value: (rule.codes ?? []).join(', '),
                onChange: next => patch({ codes: splitList(next) }),
                placeholder: 'RATE_LIMIT, QUOTA, TIMEOUT',
              })))
        default:
          return null
      }
    }

    function RuleCard({ rule, index, count, groups, t, drag, onChange, onRemove, onMove }) {
      const [open, setOpen] = React.useState(false)
      return h('div', {
        className: cls(`${PREFIX}-rule`, drag.over && `${PREFIX}-ruleOver`, drag.dragging && `${PREFIX}-ruleDragging`),
        onDragOver: event => {
          event.preventDefault()
          drag.onOver()
        },
        onDrop: event => {
          event.preventDefault()
          drag.onDrop()
        },
      },
      h('div', {
        className: `${PREFIX}-ruleHead`,
        draggable: true,
        title: t('rules.drag'),
        onDragStart: (event) => {
          event.dataTransfer.effectAllowed = 'move'
          try {
            event.dataTransfer.setData('text/plain', String(index))
          } catch (_) {
            // Some browsers refuse data on a synthetic drag; the index ref still tracks it.
          }
          drag.onStart()
        },
        onDragEnd: drag.onEnd,
      },
      h('span', { className: `${PREFIX}-handle`, 'aria-hidden': true }, '⠿'),
      h('span', { className: `${PREFIX}-badge`, title: t('rules.drag') }, String(index + 1)),
      h('span', { className: `${PREFIX}-ruleTitle` }, t(`kind.${rule.type}`)),
      h('span', { className: `${PREFIX}-hintText` }, ruleSummary(rule, t)),
      h('span', { className: `${PREFIX}-spacer` }),
      h(Checkbox, {
        checked: rule.enabled !== false,
        onChange: next => onChange({ ...rule, enabled: next }),
        label: t('rules.enabled'),
      }),
      h(Button, { kind: 'ghost', onClick: () => onMove(-1), disabled: index === 0, title: t('rules.moveUp') }, '↑'),
      h(Button, { kind: 'ghost', onClick: () => onMove(1), disabled: index === count - 1, title: t('rules.moveDown') }, '↓'),
      h(Button, { kind: 'ghost', onClick: () => setOpen(value => !value) }, open ? '▾' : '▸'),
      h(Button, { kind: 'danger', onClick: onRemove, title: t('rules.remove') }, '×')),
      open
        ? h('div', { className: `${PREFIX}-ruleBody` },
          h('div', { className: `${PREFIX}-ruleTarget` },
            h('span', { className: `${PREFIX}-label` }, t('rules.target')),
            h('div', { style: { flex: '1 1 260px', minWidth: '200px' } },
              h(TargetPicker, {
                value: rule.target,
                groups,
                t,
                onChange: next => onChange({ ...rule, target: next ?? { provider: '', model: '' } }),
              }))),
          h('p', { className: `${PREFIX}-hintText` }, t(`kind.${rule.type}.hint`)),
          h(RuleFields, { rule, groups, t, onChange }))
        : null)
    }

    function ModelCard({ model, index, groups, t, onChange, onRemove }) {
      const dragIndex = React.useRef(null)
      const [dropIndex, setDropIndex] = React.useState(null)
      const rules = Array.isArray(model.rules) ? model.rules : []
      const patch = next => onChange({ ...model, ...next })
      const replaceRule = (position, rule) => patch({ rules: rules.map((current, at) => (at === position ? rule : current)) })
      const moveRule = (from, to) => {
        if (to < 0 || to >= rules.length || from === to) return
        const next = [...rules]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        patch({ rules: next })
      }
      const capabilityFollowsFallback = model.capability === null || model.capability === undefined

      return h('div', { className: `${PREFIX}-card` },
        h('div', { className: `${PREFIX}-cardHead` },
          h('span', { className: `${PREFIX}-cardTitle` }, model.name || model.id || t('model.title')),
          h('span', { className: `${PREFIX}-badge` }, `auto-model/${model.id || '…'}`),
          h('span', { className: `${PREFIX}-spacer` }),
          h(Button, {
            kind: 'danger',
            onClick: () => {
              if (window.confirm(t('model.confirmRemove'))) onRemove()
            },
          }, t('model.remove'))),
        h('div', { className: `${PREFIX}-grid` },
          h(Field, { label: t('model.id'), hint: t('model.idHint') },
            h(TextInput, {
              value: model.id ?? '',
              onChange: next => patch({ id: next.replace(/\s/g, '') }),
              mono: true,
              placeholder: 'auto',
            })),
          h(Field, { label: t('model.name') },
            h(TextInput, { value: model.name ?? '', onChange: next => patch({ name: next }), placeholder: 'Auto' })),
          h(Field, { label: t('model.description') },
            h(TextInput, { value: model.description ?? '', onChange: next => patch({ description: next }) }))),
        h(Field, { label: t('model.fallback'), hint: t('model.fallbackHint') },
          h(TargetPicker, {
            value: model.fallback,
            groups,
            t,
            allowEmpty: true,
            onChange: next => patch({ fallback: next }),
          })),
        h(Field, { label: t('model.capability'), hint: t('model.capabilityHint') },
          h('div', { className: `${PREFIX}-row` },
            h(Checkbox, {
              checked: capabilityFollowsFallback,
              onChange: next => patch({ capability: next ? null : (model.fallback ?? null) }),
              label: t('model.capabilityFollow'),
            }),
            capabilityFollowsFallback
              ? null
              : h('div', { style: { flex: '1 1 260px', minWidth: '200px' } },
                h(TargetPicker, {
                  value: model.capability,
                  groups,
                  t,
                  allowEmpty: true,
                  onChange: next => patch({ capability: next }),
                })))),
        h('div', { className: `${PREFIX}-sectionHead` },
          h('h4', { className: `${PREFIX}-sectionTitle` }, t('rules.title')),
          h(Select, {
            value: '',
            onChange: (type) => {
              if (type === '') return
              patch({ rules: [...rules, newRule(type)] })
            },
          },
          h('option', { value: '' }, t('rules.add')),
          RULE_KINDS.map(type => h('option', { key: type, value: type }, t(`kind.${type}`))))),
        rules.length === 0
          ? h('p', { className: `${PREFIX}-hintText` }, t('rules.empty'))
          : h('div', { className: `${PREFIX}-rules` }, rules.map((rule, position) => h(RuleCard, {
            key: rule.id ?? `${model.id}-${position}`,
            rule,
            index: position,
            count: rules.length,
            groups,
            t,
            drag: {
              dragging: dropIndex === -1 && dragIndex.current === position,
              over: dropIndex === position && dragIndex.current !== null && dragIndex.current !== position,
              onStart: () => {
                dragIndex.current = position
                setDropIndex(-1)
              },
              onOver: () => setDropIndex(position),
              onDrop: () => {
                const from = dragIndex.current
                dragIndex.current = null
                setDropIndex(null)
                if (from !== null) moveRule(from, position)
              },
              onEnd: () => {
                dragIndex.current = null
                setDropIndex(null)
              },
            },
            onChange: next => replaceRule(position, next),
            onRemove: () => patch({ rules: rules.filter((_, at) => at !== position) }),
            onMove: direction => moveRule(position, position + direction),
          }))))
    }

    const filled = value => typeof value === 'string' && value.trim().length > 0

    const validClock = (value) => {
      const match = /^(\d{1,2}):(\d{2})$/.exec(typeof value === 'string' ? value.trim() : '')
      return match !== null && Number(match[1]) <= 23 && Number(match[2]) <= 59
    }

    const validTimeZone = (value) => {
      if (typeof value !== 'string' || value.trim().length === 0) return true
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: value.trim() })
        return true
      } catch {
        return false
      }
    }

    /** Why a `{ provider, model }` pair is unusable: 'missing', 'self', or null. */
    const targetProblem = (target) => {
      if (target === null || typeof target !== 'object') return 'missing'
      if (!filled(target.provider) || !filled(target.model)) return 'missing'
      // The Host refuses a forward back into this provider, so the page must too.
      return target.provider.trim() === PROVIDER_ID ? 'self' : null
    }

    /**
     * Local validation: the Host silently drops an unusable entry, so the page
     * blocks the save. Each check mirrors `lib/state.js`; `test/client-parity.test.js`
     * fails when the two drift apart, so change both together.
     */
    function problemsOf(draft, t) {
      const problems = []
      const models = Array.isArray(draft.virtualModels) ? draft.virtualModels : []
      if (models.length === 0) problems.push(t('problem.noModels'))
      const seen = new Set()
      models.forEach((model, modelIndex) => {
        const id = typeof model.id === 'string' ? model.id.trim() : ''
        const label = id.length > 0 ? id : `${modelIndex + 1}`
        if (id.length === 0 || id.includes('/') || /\s/.test(id)) problems.push(t('problem.modelId'))
        else if (seen.has(id)) problems.push(t('problem.modelIdDuplicate', { id }))
        seen.add(id)
        const fallbackProblem = targetProblem(model.fallback)
        if (fallbackProblem !== null) {
          problems.push(t(fallbackProblem === 'self' ? 'problem.targetSelf' : 'problem.fallback', { id: label }))
        }
        const rules = Array.isArray(model.rules) ? model.rules : []
        rules.forEach((rule, ruleIndex) => {
          const at = ruleIndex + 1
          const ruleProblem = targetProblem(rule.target)
          if (ruleProblem !== null) {
            problems.push(t(ruleProblem === 'self' ? 'problem.targetSelf' : 'problem.ruleTarget', { id: label, index: at }))
          }
          if (rule.type === 'first-message-keyword' || rule.type === 'recent-message-keyword') {
            const keywords = Array.isArray(rule.keywords) ? rule.keywords.filter(keyword => filled(keyword)) : []
            if (keywords.length === 0) problems.push(t('problem.ruleKeywords', { id: label, index: at }))
          }
          if (rule.type === 'command' && !filled(rule.command)) {
            problems.push(t('problem.ruleCommand', { id: label, index: at }))
          }
          if (rule.type === 'time-of-day') {
            if (!validClock(rule.from) || !validClock(rule.to)) problems.push(t('problem.ruleClock', { id: label, index: at }))
            if (!validTimeZone(rule.timeZone)) problems.push(t('problem.ruleZone', { id: label, index: at }))
          }
          if (rule.type === 'datetime-range') {
            const from = filled(rule.from) ? new Date(rule.from).getTime() : Number.NaN
            const to = filled(rule.to) ? new Date(rule.to).getTime() : Number.NaN
            if (Number.isNaN(from) || Number.isNaN(to)) problems.push(t('problem.ruleDates', { id: label, index: at }))
          }
        })
      })
      return problems
    }

    const emptyDraft = () => ({
      virtualModels: [],
      defaultCommandTimeoutMs: 8000,
      retryBudgetMs: 90000,
      maxSwitches: 4,
      logRouting: false,
    })

    function ConfigPage(props) {
      const { form, t } = props
      const snapshot = form?.state
      const status = snapshot?.status
      const serverLive = snapshot?.value?.live
      const saved = React.useMemo(() => ({ ...emptyDraft(), ...plain(serverLive ?? {}) }), [serverLive])
      const [draft, setDraft] = React.useState(saved)
      const [dirty, setDirty] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState(null)
      const [catalog, setCatalog] = React.useState({ status: 'loading', groups: [] })

      React.useEffect(() => {
        if (!dirty) setDraft(saved)
      }, [saved, dirty])

      React.useEffect(() => {
        let alive = true
        const remote = binding.remote
        const modelCatalog = remote?.session?.modelCatalog
        if (typeof modelCatalog !== 'function') {
          setCatalog({ status: 'error', groups: [] })
          return () => { alive = false }
        }
        modelCatalog.call(remote.session).then((response) => {
          if (!alive) return
          if (response?.ok === true) {
            setCatalog({
              status: 'ready',
              groups: (response.value.groups ?? []).filter(group => group.id !== PROVIDER_ID),
            })
          } else {
            setCatalog({ status: 'error', groups: [] })
          }
        }).catch(() => {
          if (alive) setCatalog({ status: 'error', groups: [] })
        })
        return () => { alive = false }
      }, [])

      const groups = catalog.groups
      const update = (mutate) => {
        setDraft(current => (typeof mutate === 'function' ? mutate(current) : mutate))
        setDirty(true)
        setMessage(null)
      }

      const problems = problemsOf(draft, t)
      const models = Array.isArray(draft.virtualModels) ? draft.virtualModels : []

      const save = async () => {
        if (problems.length > 0) {
          setMessage({ kind: 'error', text: problems[0] })
          return
        }
        setBusy(true)
        setMessage(null)
        try {
          const accepted = await form.mutate([{ op: 'set', path: ['live'], value: plain(draft) }])
          if (accepted === true) {
            setDirty(false)
            setMessage({ kind: 'ok', text: t('panel.saved') })
          } else {
            setMessage({ kind: 'error', text: t('panel.refused') })
          }
        } catch (error) {
          setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        } finally {
          setBusy(false)
        }
      }

      if (form === undefined || status === 'unavailable') {
        return h('div', { className: `${PREFIX}-root` }, h(Styles), h('p', { className: `${PREFIX}-intro` }, t('panel.unavailable')))
      }
      if (status === 'loading' || snapshot === undefined) {
        return h('div', { className: `${PREFIX}-root` }, h(Styles), h('p', { className: `${PREFIX}-intro` }, t('panel.loading')))
      }

      return h('div', { className: `${PREFIX}-root` },
        h(Styles),
        h('div', { className: `${PREFIX}-sectionHead` },
          h('div', null,
            h('h3', { className: `${PREFIX}-sectionTitle` }, t('panel.title')),
            h('p', { className: `${PREFIX}-intro` }, t('panel.intro'))),
          h('div', { className: `${PREFIX}-row` },
            dirty ? h('span', { className: `${PREFIX}-badge ${PREFIX}-badgeWarn` }, t('panel.dirty')) : null,
            h(Button, { onClick: () => { setDraft(saved); setDirty(false); setMessage(null) }, disabled: !dirty || busy }, t('panel.reset')),
            h(Button, { kind: 'primary', onClick: save, disabled: !dirty || busy }, t('panel.save')))),
        message === null
          ? null
          : h('div', { className: cls(`${PREFIX}-status`, message.kind === 'ok' ? `${PREFIX}-statusOk` : `${PREFIX}-statusError`), role: 'status' }, message.text),
        problems.length > 0 && dirty
          ? h('div', null,
            h('p', { className: `${PREFIX}-label` }, t('panel.problems')),
            h('ul', { className: `${PREFIX}-problems` }, problems.map((problem, index) => h('li', { key: index }, problem))))
          : null,
        h('div', { className: `${PREFIX}-section` },
          h('div', { className: `${PREFIX}-sectionHead` },
            h('h3', { className: `${PREFIX}-sectionTitle` }, t('panel.title')),
            h(Button, {
              onClick: () => update(current => ({
                ...current,
                virtualModels: [
                  ...(Array.isArray(current.virtualModels) ? current.virtualModels : []),
                  {
                    id: `auto-${(Array.isArray(current.virtualModels) ? current.virtualModels.length : 0) + 1}`,
                    name: 'Auto',
                    description: '',
                    fallback: null,
                    capability: null,
                    rules: [],
                  },
                ],
              })),
            }, t('panel.addModel'))),
          models.length === 0
            ? h('p', { className: `${PREFIX}-hintText` }, t('panel.empty'))
            : models.map((model, index) => h(ModelCard, {
              key: `model-${index}`,
              model,
              index,
              groups,
              t,
              onChange: next => update(current => ({
                ...current,
                virtualModels: current.virtualModels.map((candidate, at) => (at === index ? next : candidate)),
              })),
              onRemove: () => update(current => ({
                ...current,
                virtualModels: current.virtualModels.filter((_, at) => at !== index),
              })),
            }))),
        h('div', { className: `${PREFIX}-section` },
          h('h3', { className: `${PREFIX}-sectionTitle` }, t('panel.settings')),
          h('div', { className: `${PREFIX}-grid` },
            h(Field, { label: t('panel.retryBudget'), hint: t('panel.retryBudgetHint') },
              h(NumberInput, {
                value: draft.retryBudgetMs,
                min: 0,
                step: 1000,
                onChange: next => update(current => ({ ...current, retryBudgetMs: next ?? 0 })),
              })),
            h(Field, { label: t('panel.maxSwitches') },
              h(NumberInput, {
                value: draft.maxSwitches,
                min: 0,
                step: 1,
                onChange: next => update(current => ({ ...current, maxSwitches: next ?? 1 })),
              })),
            h(Field, { label: t('panel.commandTimeout') },
              h(NumberInput, {
                value: draft.defaultCommandTimeoutMs,
                min: 100,
                step: 500,
                onChange: next => update(current => ({ ...current, defaultCommandTimeoutMs: next ?? 8000 })),
              }))),
          h(Checkbox, {
            checked: draft.logRouting === true,
            onChange: next => update(current => ({ ...current, logRouting: next })),
            label: t('panel.logRouting'),
          })),
        catalog.status === 'error'
          ? h('p', { className: `${PREFIX}-hintText` }, 'Model catalog unavailable; use custom provider/model fields.')
          : null)
    }

    function ConfigEntry(props) {
      const { view, form } = props
      const t = props.t ?? binding.translate
      if (view === 'summary') {
        const live = form?.state?.value?.live
        const models = Array.isArray(live?.virtualModels) ? live.virtualModels : []
        const rules = models.reduce((total, model) => total + (Array.isArray(model.rules) ? model.rules.length : 0), 0)
        return h('span', null, t('summary.models', { models: models.length, rules }))
      }
      return h(ConfigPage, { ...props, t })
    }

    /** User-only hint: which real model currently answers for this Session. */
    function SessionHint(props) {
      const { sessionId, useSessions } = props
      const t = props.t ?? binding.translate
      const summary = useSessions(state => state.byId[sessionId])
      const route = summary?.projectionValues?.autoModelRoute
      if (route === null || route === undefined || typeof route !== 'object') return null
      return h('div', { className: `${PREFIX}-hint`, title: `${route.provider}/${route.model}` },
        h(Styles),
        h('span', { className: `${PREFIX}-hintLabel` }, t('hint.label')),
        h('span', { className: `${PREFIX}-hintValue` }, route.virtualName ?? route.virtualModel),
        h('span', { className: `${PREFIX}-hintArrow` }, '→'),
        h('span', { className: `${PREFIX}-hintValue` }, route.modelName ?? route.model))
    }

    const entry = {
      inject: ['slots', 'locale', 'remote', 'remote.session'],
      apply(ctx) {
        binding.remote = ctx.remote
        binding.translate = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-auto-model: dictionaries')
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: `${PACKAGE_NAME}#${ROW_ID}`,
          locale: NS,
        }, ConfigEntry))
        ctx.slots.inject('sidebar.session.row.hover', () => ctx.slots.register({
          name: 'sidebar.session.row.hover',
          id: 'auto-model-real-model',
          order: 10,
          locale: NS,
        }, SessionHint))
      },
    }

    // Test seam: `test/client-parity.test.js` loads this factory under a stub
    // loader and compares the page's validation with the Host normalizer. The
    // flag is never set in a running Harness, so the shipped entry keeps its
    // manifest shape.
    if (globalThis.__DSH_AUTO_MODEL_TEST__ === true) entry.problemsOf = problemsOf

    return entry
  },
})
