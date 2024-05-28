<template>
  <div class="custom-select-wrapper" @click="toggleDropdown">
    <div class="custom-select" :class="{ 'open': isOpen }">
      <div class="custom-select__trigger">
        <span>{{ selectedOptionName }}</span>
        <div class="arrow"></div>
      </div>
      <div class="custom-options" v-show="isOpen">
        <div class="custom-option" v-for="option in options" :key="option.value"
          :class="{ 'selected': option.value === modelSelected, 'disabled': option.disabled }"
          @click="selectOption(option)" v-text="option.name"></div>
      </div>
    </div>
  </div>
</template>
  
<script>
export default {
  props: {
    modelValue: {
      type: String,
      default: ''
    },
    options: {
      type: Array,
      required: true,
    },
  },
  data() {
    return {
      isOpen: false,
      modelSelected: "deepseek-chat",
      selectedOptionName: "",
      // options: [
      //   { name: "选择聊天模型", value: null, disabled: true },
      //   { name: "gpt-3.5-turbo-16k-0613", value: "gpt-3.5-turbo-16k-0613", disabled: false },
      //   { name: "gpt-3.5-turbo-16k", value: "gpt-3.5-turbo-16k", disabled: false },
      //   { name: "gpt-3.5-turbo-1106", value: "gpt-3.5-turbo-1106", disabled: false },
      //   { name: "gpt-3.5-turbo-0613", value: "gpt-3.5-turbo-0613", disabled: false },
      //   { name: "gpt-3.5-turbo-0301", value: "gpt-3.5-turbo-0301", disabled: false },
      //   { name: "gpt-3.5-turbo", value: "gpt-3.5-turbo", disabled: false },
      //   { name: "GPT-4(暂时关闭)", value: "GPT-4", disabled: true },
      //   { name: "Gemini Pro(内测)", value: "Gemini Pro", disabled: true }
      // ],
    };
  },
  mounted() {
    // 当组件挂载时, 设置正确的选中选项名称
    this.setSelectedOptionName();
  },
  methods: {
    toggleDropdown() {
      this.isOpen = !this.isOpen;
    },
    selectOption(option) {
      if (option.disabled) {
        return;
      }
      this.modelSelected = option.value; // 更新本地的选中值
      this.selectedOptionName = option.name; // 更新选中值的显示名称
      this.isOpen = false;
      // 触发update:modelValue事件，以便v-model可以更新父组件的值
      this.$emit('update:modelValue', this.modelSelected);
      this.isOpen = !this.isOpen;
    },
    setSelectedOptionName() {
      // 根据modelValue prop找到对应的选项
      const selectedOption = this.options.find(option => option.value === this.modelValue);
      this.selectedOptionName = selectedOption ? selectedOption.name : '';
    }
  },
  watch: {
    // 当父组件的v-model值变化时更新
    modelValue(newVal) {
      this.modelSelected = newVal; // 同步更新本地的modelSelected
      this.setSelectedOptionName(); // 更新显示的选中选项名称
    }
  },
};
</script>
  
<style scoped>
.custom-select-wrapper {
  position: relative;
  font-family: Arial, sans-serif;
  width: 256px;
  z-index: 1000;
}

.custom-select {
  border: 1px solid #ccc;
  border-radius: 4px;
  overflow: hidden;
}

.custom-select__trigger {
  background-color: #f8f8f8;
  padding: 10px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.arrow {
  width: 0;
  height: 0;
  border: 5px solid transparent;
  border-bottom-color: #333;
  /* 箭头方向向下 */
  margin-left: 5px;
  /* 当下拉框打开时，箭头应该向上 */
  transform: translateY(2px);
  /* 调整箭头的位置 */
}

.custom-select.open .arrow {
  transform: rotate(180deg) translateY(-2px);
  /* 箭头向上时，稍微调整位置 */
}

.custom-options {
  position: absolute;
  max-height: calc(25vh);
  overflow: hidden;
  overflow-y: auto;
  bottom: 100%;
  /* 使选项框出现在触发器上方 */
  left: 0;
  right: 0;
  border: 1px solid #ccc;
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  background-color: #fff;
  z-index: 1000;
}

/* 渐变动画效果 */
@keyframes fadeInOut {
  from {
    opacity: 0;
    transform: translateY(10px);
  }

  to {
    opacity: 1;
    transform: translateY(0px);
  }
}

/* 下拉框的淡入淡出动画效果 */
.custom-select.open .custom-options {
  animation: fadeInOut 0.3s ease-out;
}

.custom-option {
  padding: 10px;
  cursor: pointer;
  transition: background-color 0.3s;
}

.custom-option:hover {
  background-color: #f0f0f0;
}

.custom-option.selected {
  color: #5c9cd8;
}

.custom-option.disabled {
  color: #ccc;
  cursor: not-allowed;
}
</style>
  