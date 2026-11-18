/* eslint-disable vue/one-component-per-file */
import { describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, watch } from "vue"
import { getService } from "~/modules/dioc"
import { SecretEnvironmentService } from "~/services/secret-environment.service"
import { CurrentValueService } from "~/services/current-environment-value.service"

vi.mock("@composables/i18n", () => ({ useI18n: () => (k: string) => k }))
vi.mock("@composables/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))
vi.mock("@composables/theming", () => ({
  useColorMode: () => ({ value: "light" }),
}))
vi.mock("~/platform", () => ({ platform: {} }))
vi.mock("~/modules/dioc", async () => {
  const { Container } = await import("dioc")
  const container = new Container()
  ;(globalThis as any).__testContainer = container
  return { getService: (s: any) => container.bind(s) }
})
vi.mock("dioc/vue", () => ({
  useService: (s: any) => (globalThis as any).__testContainer.bind(s),
}))

import {
  createEnvironment,
  environmentsStore,
  setSelectedEnvironmentIndex,
} from "~/newstore/environments"
import Details from "../Details.vue"
import TeamDetails from "../../teams/Details.vue"
import * as TE from "fp-ts/TaskEither"

vi.mock("~/helpers/backend/mutations/TeamEnvironment", () => ({
  createTeamEnvironment: vi.fn(),
  updateTeamEnvironment: vi.fn(() => TE.right({})),
}))
vi.mock("~/helpers/backend/GQLClient", () => ({}))

const passthrough = (tag = "div") =>
  defineComponent({
    inheritAttrs: true,
    setup(_, { slots }) {
      return () =>
        h(tag, {}, [slots.default?.(), slots.body?.(), slots.footer?.()])
    },
  })

const Button = defineComponent({
  props: ["label", "title", "icon"],
  setup(props) {
    return () => h("button", { "data-label": props.label ?? props.title })
  },
})

const Modal = defineComponent({
  setup(_, { slots }) {
    return () => h("div", [slots.body?.(), slots.footer?.()])
  },
})

const EnvInput = defineComponent({
  props: ["modelValue", "name"],
  emits: ["update:modelValue"],
  setup(props) {
    return () => h("input", { name: props.name, value: props.modelValue })
  },
})

// Mirrors SmartEnvInput's secret mode (components/smart/EnvInput.vue).
const SecretEnvInput = defineComponent({
  props: ["modelValue", "name", "secret"],
  emits: ["update:modelValue", "change"],
  setup(props, { emit }) {
    const isSecret = ref(props.secret)
    const secretText = ref(props.modelValue)
    watch(
      () => secretText.value,
      (newVal) => {
        if (isSecret.value) emit("update:modelValue", newVal)
      }
    )
    watch(
      () => props.modelValue,
      (newVal) => {
        if (secretText.value !== newVal) secretText.value = newVal
      },
      { immediate: true }
    )
    return () =>
      isSecret.value
        ? h("input", {
            type: "password",
            name: props.name,
            value: secretText.value,
            onInput: (e: Event) =>
              (secretText.value = (e.target as HTMLInputElement).value),
          })
        : h("input", { name: props.name, value: props.modelValue })
  },
})

const mountDetails = (
  props: Record<string, unknown>,
  component: any = Details,
  envInput: any = EnvInput
) => {
  const el = document.createElement("div")
  document.body.appendChild(el)
  const state = { ...props }
  let setShow: (v: boolean) => void = () => {}
  const Root = defineComponent({
    data: () => ({ show: false }),
    created() {
      setShow = (v) => ((this as any).show = v)
    },
    render() {
      return h(component, { ...state, show: (this as any).show })
    },
  })
  const app = createApp(Root)
  app.component("HoppSmartModal", Modal)
  app.component("HoppSmartTabs", passthrough())
  app.component("HoppSmartTab", passthrough())
  app.component("HoppSmartPlaceholder", passthrough())
  app.component("HoppSmartItem", Button)
  app.component("HoppButtonSecondary", Button)
  app.component("HoppButtonPrimary", Button)
  app.component("SmartEnvInput", envInput)
  app.component("tippy", passthrough())
  app.directive("tippy", {})
  app.directive("focus", {})
  app.mount(el)
  return { el, app, setShow: (v: boolean) => setShow(v) }
}

describe("my/Details save — secret store", () => {
  it("rewrites secret slots after deleting the first of two same-key secrets", async () => {
    const secrets = getService(SecretEnvironmentService)
    const current = getService(CurrentValueService)

    createEnvironment(
      "E",
      [
        { key: "X", initialValue: "", currentValue: "", secret: true },
        { key: "X", initialValue: "", currentValue: "", secret: true },
      ],
      "env-1"
    )
    const index = environmentsStore.value.environments.length - 1
    setSelectedEnvironmentIndex({ type: "MY_ENV", index })
    secrets.addSecretEnvironment("env-1", [
      { key: "X", value: "first", varIndex: 0, initialValue: "" },
      { key: "X", value: "second", varIndex: 1, initialValue: "" },
    ])
    current.addEnvironment("env-1", [])

    const { el, setShow } = mountDetails({
      action: "edit",
      editingEnvironmentIndex: index,
    })
    setShow(true)
    await nextTick()
    await nextTick()

    const removeButtons = [
      ...el.querySelectorAll('button[data-label="action.remove"]'),
    ]
    ;(removeButtons[0] as HTMLButtonElement).click()
    await nextTick()

    ;(
      el.querySelector('button[data-label="action.save"]') as HTMLButtonElement
    ).click()
    await nextTick()

    expect(secrets.getSecretEnvironment("env-1")).toEqual([
      { key: "X", value: "second", varIndex: 0, initialValue: "" },
    ])
  })

  const runDeleteFirstAndSave = async (el: HTMLElement) => {
    const before = [...el.querySelectorAll("input[type=password]")].map(
      (i) => (i as HTMLInputElement).value
    )
    const removeButtons = [
      ...el.querySelectorAll('button[data-label="action.remove"]'),
    ]
    ;(removeButtons[0] as HTMLButtonElement).click()
    await nextTick()
    ;(
      el.querySelector('button[data-label="action.save"]') as HTMLButtonElement
    ).click()
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()
    return before
  }

  it("Global", async () => {
    const secrets = getService(SecretEnvironmentService)
    const { setGlobalEnvVariables } = await import("~/newstore/environments")
    setGlobalEnvVariables({
      v: 2,
      variables: [
        { key: "X", initialValue: "", currentValue: "", secret: true },
        { key: "X", initialValue: "", currentValue: "", secret: true },
      ],
    } as any)
    secrets.addSecretEnvironment("Global", [
      { key: "X", value: "first", varIndex: 0, initialValue: "" },
      { key: "X", value: "second", varIndex: 1, initialValue: "" },
    ])
    const { el, setShow } = mountDetails({
      action: "edit",
      editingEnvironmentIndex: "Global",
    })
    setShow(true)
    await nextTick()
    await nextTick()
    await runDeleteFirstAndSave(el)
    expect(secrets.getSecretEnvironment("Global")).toEqual([
      { key: "X", value: "second", varIndex: 0, initialValue: "" },
    ])
  })

  it("team", async () => {
    const secrets = getService(SecretEnvironmentService)
    const teamEnv = {
      id: "team-env-1",
      teamID: "team-1",
      environment: {
        v: 2,
        id: "team-env-1",
        name: "T",
        variables: [
          { key: "X", initialValue: "", currentValue: "", secret: true },
          { key: "X", initialValue: "", currentValue: "", secret: true },
        ],
      },
    }
    secrets.addSecretEnvironment("team-env-1", [
      { key: "X", value: "first", varIndex: 0, initialValue: "" },
      { key: "X", value: "second", varIndex: 1, initialValue: "" },
    ])
    const { el, setShow } = mountDetails(
      {
        action: "edit",
        editingEnvironment: teamEnv,
        editingTeamId: "team-1",
      },
      TeamDetails,
      SecretEnvInput
    )
    setShow(true)
    await nextTick()
    await nextTick()
    await runDeleteFirstAndSave(el)
    expect(secrets.getSecretEnvironment("team-env-1")).toEqual([
      { key: "X", value: "second", varIndex: 0, initialValue: "" },
    ])
  })
})
