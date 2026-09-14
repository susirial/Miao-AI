<script setup lang="ts" generic="U extends ZodAny">
import type { ZodAny } from 'zod'
import type { Config, ConfigItem, Shape } from './interface'
import { computed } from 'vue'
import { DEFAULT_ZOD_HANDLERS, INPUT_COMPONENTS } from './constant'
import useDependencies from './dependencies'

const props = defineProps<{
  fieldName: string
  shape: Shape
  config?: ConfigItem | Config<U>
}>()

function isValidConfig(config: any): config is ConfigItem {
  return !!config?.component
}

const delegatedProps = computed(() => {
  if (['ZodObject', 'ZodArray'].includes(props.shape?.type))
    return { schema: props.shape?.schema }
  return undefined
})

const defaultHandler = computed(() => DEFAULT_ZOD_HANDLERS[props.shape.type])

const resolvedComponent = computed(() => {
  if (isValidConfig(props.config)) {
    return typeof props.config.component === 'string'
      ? INPUT_COMPONENTS[props.config.component]
      : props.config.component
  }

  const handler = defaultHandler.value
  return handler ? INPUT_COMPONENTS[handler] : undefined
})

const { isDisabled, isHidden, isRequired, overrideOptions } = useDependencies(props.fieldName)
</script>

<template>
  <component
    :is="resolvedComponent"
    v-if="!isHidden && resolvedComponent"
    :field-name="fieldName"
    :label="shape.schema?.description"
    :required="isRequired || shape.required"
    :options="overrideOptions || shape.options"
    :disabled="isDisabled"
    :config="config"
    v-bind="delegatedProps"
  >
    <slot />
  </component>
</template>
