<template>
  <div class="AIChat">
    <RoleStoreCard :is-open="isRoleStoreOpen" :chooseIndex="Live2DIndex" @close="handleRoleStoreClose"
      :live2dList="live2dList" @update:live2dList="handleLive2dListUpdate" @update:chooseIndex="handleLive2dIndexUpdate">
    </RoleStoreCard>
    <button class="showList button" v-if="isHidden" @click="toggleHidden" style="width:48px;">
      <img src="../assets/right.svg" alt="显性" title="展开" class="show-icon" style="width:15px;" />
    </button>
    <!-- 左边框 -->
    <div class="left-box" :class="{ 'hidden': isHidden }">
      <div class="optionBox">
        <button class="newChat button" @click="createNewChat">
          <img src="../assets/add.svg" alt="新建" title="新建" class="add-icon" style="width:15px;" />
          新聊天
        </button>
        <button class="save button" @click="deleteChatHistory">
          <img src="../assets/icon/delete-all.svg" alt="保存" title="清空记录" class="add-icon" style="width:15px;" />
        </button>
        <button class="hiden button" @click="toggleHidden">
          <img src="../assets/left.svg" alt="隐藏" title="隐藏" class="hiden-icon" style="width:15px;" />
        </button>
      </div>
      <!-- 历史条目 -->
      <div class="historyList">
      <div v-for="historyItem in chatHistoryItems" :key="historyItem.id"
        :class="{ 'historyItem': true, 'historyItemActive': historyItem.isActive }"
        @click="activateHistoryItem(historyItem.id)">
        <span>{{ historyItem.name }}</span>
        <img class="rename-icon icon-item" @click="reNameHistoryItem(historyItem.id)" src="../assets/icon/rename.svg"
          alt="重命名" title="重命名" style="margin-right:0px;width:28px;" />
        <img class="delete-icon icon-item" @click="deleteHistoryItem(historyItem.id)" src="../assets/icon/delete-lite.svg" alt="删除" title="删除"
          style="margin-right:0px;width:28px;" />
      </div>
    </div>
    <!-- live2D -->
    <live2D ref="live2DComponent" :class="{ 'hidden': isHidden }" v-if="live2dList[Live2DIndex].role_url" :url="live2dList[Live2DIndex].role_url"
      :height="live2dList[Live2DIndex].height" :width="live2dList[Live2DIndex].width"
      :scale="live2dList[Live2DIndex].scale" :x="live2dList[Live2DIndex].x" :ideaAc="live2dList[Live2DIndex].idle"
      :talkAc="live2dList[Live2DIndex].talk"></live2D>
    </div>
    <div class="right-box">
      <div class="chat-container" ref="chatContainer" @scroll="checkScrollBottom">
        <div class="tools-container" v-if="nowChatHistory.length === 0">
          <!-- 栏目：选择模型，角色仓库，pdf分析，换肤 -->
          <div class="toolsBox">
            <custom-select class="customselect" v-model="modelSelected" :options="this.modelData"></custom-select>
            <img class="toolsBox-buttonIcon" alt="角色仓库" title="角色仓库" src="../assets/aiChatIcon/rolesApp.svg"
              @click="openRoleStore" />
            <!-- TODO:换肤 -->
            <img class="toolsBox-buttonIcon" alt="换肤" title="换肤" src="../assets/aiChatIcon/skin.svg"
              @click="openSkinStore" />
            <img class="toolsBox-buttonIcon" alt="pdf分析" title="pdf分析" src="../assets/aiChatIcon/pdf.svg"
              @click="openFileDialog" style="height: 42px;width: 42px;" />
            <input type="file" ref="fileInput" style="display: none" @change="onFileSelected" accept="application/pdf" />
          </div>
          <!-- 角色滚动条 -->
          <transition name="slide" mode="out-in">
            <div class="live2d-role">
              <div v-for="(role, index) in live2dList" :key="role.id" class="avatar-container"
                :class="{ 'active-avatar': Live2DIndex === index }" @click="updateLive2DIndex(index)">
                <img :src="role.avatar || defaultAvatar" @error="setDefaultAvatar" class="live2d-avatar" alt="Role Avatar"
                  :title="role.role_name" />
              </div>
            </div>
          </transition>
        </div>
        <!-- 信息内容 -->
        <div class="messagesBox">
          <div v-for="(message, index) in nowChatHistory" :key="index" class="messages">
            <div class="avatar" :class="{ 'user-avatar': message.fromUser, 'ai-avatar': !message.fromUser }">
              <img :src="message.avatar || defaultAvatar" @error="setDefaultAvatar" alt="Avatar" class="avatar" />
            </div>
            <div class="message">
              <div :class="{ 'user-message': message.fromUser, 'ai-message': !message.fromUser }">
                <!-- {{ message.content }} -->
                <v-md-preview :text="message.content" @copy-code-success="handleCopyCodeSuccess"></v-md-preview>
              </div>
              <div>
                <img src="../assets/copy.svg" alt="复制" title="复制"
                  :class="{ 'icon-copy-user': message.fromUser, 'icon-copy-ai': !message.fromUser }"
                  @click="copyMsg(message.content)" />
              </div>
              <audio class="audio-role" ref="audioPlayers" controls :src="streamingAudioUrl[index]"
                v-if="!message.fromUser && streamingAudioUrl[index] !== ''" @canplay="readyPlay"></audio>
            </div>
          </div>
        </div>
      </div>
      <!-- 输入框 -->
      <div class="text-container">
          <div class="text-box">
            <img v-if="modelSelected==='gpt-4-turbo'" src="../assets/icon/uploadPic.svg" class="text-box-icon text-box-icon-uploadPic" title="上传图片" @click="onUploadPic" />
            <input type="file" ref="imgFileInput" id="fileInput" accept="image/*" @change="selectedPic">
            <textarea ref="textarea" v-model="userInput" @keydown.enter="handleEnterKey" class="user-textarea"
              placeholder="畅你所言，按Enter发送，Shift+Enter换行" :style="{ 'height': textareaHeight }"
              :disabled="!isTextareaEnabled"></textarea>
            <div v-if="!isTextareaEnabled" class="loading-overlay">
              <!-- 加载动画效果 -->
              <div class="loading-spinner"></div>
              <img src="../assets/icon/stop.svg" class="text-box-icon-stop" title="中断回答" @click="stopAIRes" />
            </div>
          </div>
        </div>
    </div>
  </div>
</template>

<script>
//TODO：[BUG]不同聊天窗口提问相同问题，切换记录会变成第一个提问的记录样子。
import calcTextareaHeight from '@/utils/calcTextareaHeight';
import { showAlter } from "@/utils/showAlter";
import live2D from "@/components/live2D.vue";
import { live2dListData } from "@/api/live2DData";
import { uploadPic } from "@/api/picUpload";
import { requestConfig } from "@/utils/request";
import clipboard from 'clipboardy';
import * as pdfjsLib from 'pdfjs-dist/build/pdf';
import 'pdfjs-dist/build/pdf.worker.entry';
import CustomSelect from '@/components/AIChatView/CustomSelect.vue';
import RoleStoreCard from "@/components/AIChatView/RoleStore.vue";
import defaultAvatar from "@/assets/AIAvatar.jpg"

const Swal = require('sweetalert2')
export default {
  components: {
    live2D,
    CustomSelect,
    RoleStoreCard
  },
  data() {
    return {
      live2dList: live2dListData,
      Live2DIndex: 1,
      defaultAvatar: defaultAvatar,//滚动条加载失败默认图标
      streamingAudioUrl: [], // 存储流式音频 URL
      audioReady: false,
      chatHistory: [], // 存放聊天历史
      nowChatHistory: [],// 现在条目的历史记录
      isHidden: false, // 控制历史记录是否隐藏的布尔值
      chatHistoryItems: [
        { id: 1, name: 'Chat 1', isActive: false },
        { id: 2, name: 'Chat 2', isActive: false },
        { id: 3, name: 'Chat 3', isActive: false },
      ],//历史聊天条目
      userInput: '',   // 用户输入
      isTextareaEnabled: true,
      isStopStream:false,//AI流式响应对象
      isBottomScroll:false,//聊天视窗滚动条
      textareaHeight: '32px',
      messages: [
        {
          "role": "system",
          "content": "你是一个可靠的助手，将尽力帮助用户完成目标。你的回答里将不会出现任何有关AI、openAI以及chatGPT的字眼，并且不会透露任何关于你的模型的事情。"
        },
      ],
      modelSelected: "deepseek-chat",//模型选择
      //TODO:远程获取模型list
      modelData: [
        { name: "选择聊天模型", value: null, disabled: true },
        { name: "DeepSeekChat(快🚀)(默认🧐)", value: "deepseek-chat", disabled: false },
        { name: "GPT-4-turbo [🔎联网+学术检索+画图](比较慢)", value: "gpt-4-turbo", disabled: false },
        { name: "kimi-128k[超长上下文📜+🔎联网](快🚀)", value: "moonshot-v1-128k", disabled: false },
        { name: "DeepSeekCoder[👨‍💻代码特调](快🚀)", value: "deepseek-coder", disabled: false },
        { name: "GPT-4-1106-preview(强💪💪快🚀)", value: "gpt-4-1106-preview", disabled: false },
        { name: "GPT-4o(强👍不稳定👀)", value: "gpt-4o", disabled: false },
        { name: "Claude3(强👍不稳定👀)", value: "claude-3-opus-20240229", disabled: false },
        { name: "GPT-4 Copilot💝", value: "gpt-4-copilot", disabled: false },
        { name: "Gemini Pro✨", value: "gemini-pro", disabled: false },
        { name: "gpt-3.5-turbo-1106", value: "gpt-3.5-turbo-1106", disabled: false },
        { name: "gpt-3.5-turbo-0613", value: "gpt-3.5-turbo-0613", disabled: false },
        { name: "gpt-3.5-turbo-0301", value: "gpt-3.5-turbo-0301", disabled: false },
        { name: "gpt-3.5-turbo", value: "gpt-3.5-turbo", disabled: false },
        { name: "gpt-3.5-turbo-16k", value: "gpt-3.5-turbo-16k", disabled: true },
        { name: "GPT-4", value: "gpt-4", disabled: true },
        { name: "gpt-3.5-turbo-16k-0613", value: "gpt-3.5-turbo-16k-0613", disabled: true },
      ],
      isRoleStoreOpen: false,//RoleStoreCard
      uploadPic: null,
      
    };
  },
  mounted() {
    var userInfo = this.$store.getters.getUserInfo;
    if (userInfo.userName === "游客") {
      this.$router.push('/roleDisable')
    }
    this.loadLive2dDataFromLocal();
  },
  computed: {
    getUserData() {
      var userInfo = this.$store.getters.getUserInfo;
      return userInfo;
    },
    getToken() {
      return this.$store.state.token;
    },
  },
  created() {
    // 从本地存储加载聊天历史记录
    const savedChatHistory = localStorage.getItem('chatHistory');
    if (savedChatHistory) {
      this.chatHistory = JSON.parse(savedChatHistory);
    }
    // 初始化 chatHistoryItems，使用新的 id 字段
    this.chatHistoryItems = this.chatHistory.map(item => {
      return { id: item.id, name: item.item, isActive: false };
    });
    try {
      // 初始化性格特点
      if (this.live2dList[this.Live2DIndex].role_info !== undefined) {
        this.messages[0].content = this.live2dList[this.Live2DIndex].role_info;
      }
    } catch (error) {
      console.log("初始化性格特点：", error);
    }
  },
  watch: {
    userInput() {
      this.autoExpandTextarea();
    }
  },
  methods: {
    autoExpandTextarea() {
      this.textareaHeight = calcTextareaHeight(this.$refs.textarea, 1, 7).height;
    },
    setDefaultAvatar(event) {
      event.target.src = this.defaultAvatar;
    },
    handleEnterKey(event) {
      // 检查是否同时按下了 Shift 键
      if (event.shiftKey) {
        // 如果按下了 Shift 键，执行换行操作
        const inputBox = this.$refs.textarea;
        const cursorPosition = inputBox.selectionStart;
        // 在光标当前位置插入换行符
        const textBeforeCursorPosition = inputBox.value.substring(0, cursorPosition);
        const textAfterCursorPosition = inputBox.value.substring(cursorPosition);
        inputBox.value = textBeforeCursorPosition + "\n" + textAfterCursorPosition;
        // 保持光标在插入换行符后的位置
        inputBox.selectionStart = inputBox.selectionEnd = cursorPosition + 1;
      } else {
        // 如果没有按下 Shift 键，执行发送消息的操作
        this.sendMessage();
      }
    },
    handleRoleStoreClose() {
      this.isRoleStoreOpen = false;
      this.loadLive2dDataFromLocal();
    },
    //加载本地存储的live2d数据
    loadLive2dDataFromLocal() {
      if (localStorage.getItem('localLive2dList')) {
        try {
          const parsed = JSON.parse(localStorage.getItem('localLive2dList'));
          this.live2dList = parsed;
        } catch (e) {
          console.error('无法从localStorage解析localLive2dList', e);
        }
      } else {
        this.live2dList = live2dListData;
      }
    },
    handleLive2dListUpdate(newList) {
      this.live2dList = newList;
    },
    handleLive2dIndexUpdate(id) {
      const index = this.live2dList.findIndex((item) => item.id === id);
      this.updateLive2DIndex(index);
      showAlter("更换角色成功", 2);
    },
    //发送用户信息
    async sendMessage() {
      if (this.userInput === "") {
        showAlter("请输入内容！亲", 99);
        return;
      }
      if (this.nowChatHistory.length === 0) {
        const newItem = { id: Date.now(), name: this.userInput, isActive: true };
        this.chatHistoryItems.push(newItem);
      }
      // 将用户输入添加到当前历史记录数组
      const userMessage = {
        content: this.userInput,
        avatar: this.getUserData.avatar,
        fromUser: true,
      };
      this.nowChatHistory.push(userMessage);
      this.messages.push({
        "role": "user",
        "content": this.userInput
      })
      const container = this.$refs.chatContainer;
      container.scrollTop = container.scrollHeight;
      this.userInput = ''; // 清空用户输入
      this.streamingAudioUrl.push("");
      await this.AiRespon();
    },
    // 处理AI回复
    async AiRespon() {
      this.isTextareaEnabled = false;
      const url = requestConfig.baseURL1 + '/v1/chat/pri/send/stream';
      const headers = {
        'token': this.getToken,
        'Content-Type': 'application/json'
      };
      const data = {
        "model": this.modelSelected,
        "messages": this.messages,
        "temperature": 0.5,
        "stream": true
      };
      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(data)
      })
      if (!response.ok) {
        if (response.status === 401) {
          //保存
          if (this.chatHistory.length < this.chatHistoryItems.length) {
            this.pushChatHistory();
          }
          this.saveChatHistory(1);
          this.$store.dispatch('clearToken');
          this.$router.push('/login');
          showAlter("登录已过期，请重新登录")
          return;
        }
        var errorMsg = `未知错误！错误代码：[${response.status}]`;
        if (response.status === 417) {
          errorMsg = `错误代码：[${response.status}]：该模型正在维护中......`;
        }
        const responseData = await response.json();
        console.log(responseData);
        this.isTextareaEnabled = true;
        //存储ai回复错误信息
        this.messages.push({
          "role": "assistant",
          "content": errorMsg
        },);
        const aiMessage = {
          content: errorMsg,
          avatar: this.live2dList[this.Live2DIndex].avatar,
          fromUser: false,
        };
        this.nowChatHistory.push(aiMessage);
        //保存
        if (this.chatHistory.length < this.chatHistoryItems.length) {
          this.pushChatHistory();
        }
        this.saveChatHistory(1);
        showAlter(errorMsg, 0)
        return;
      }
      const reader = response.body.getReader();
      const textDecoder = new TextDecoder();
      let result = true;
      const aiMessage = {
        content: '',
        avatar: this.live2dList[this.Live2DIndex].avatar,
        fromUser: false,
      };
      while (result) {
        const { done, value } = await reader.read();
        if(this.isStopStream === true){
          reader.cancel();
          // this.isStopStream = false;
          // this.isTextareaEnabled = true;
        }
        if (done || this.isStopStream) {
          //结束，服务端断开
          result = false;
          this.messages.push({
            "role": "assistant",
            "content": aiMessage.content
          },);
          //解除不可输入状态
          this.isTextareaEnabled = true;
          this.isStopStream = false;
          //自动播放
          // this.playAudio(aiMessage.content);
          //滚动窗口到底部
          const container = this.$refs.chatContainer;
          if (this.isBottomScroll) {
            container.scrollTop = container.scrollHeight;
          }
          const n = this.chatHistoryItems.length;
          //保存
          if (this.chatHistory.length < n) {
            this.pushChatHistory();
          }
          this.saveChatHistory(1);
          //总结聊天重命名历史记录条目标题
          if(this.messages.length <= 3){
            this.getChatLittle(n - 1);
          }
          break;
        }
        const chunkText = textDecoder.decode(value);
        aiMessage.content += chunkText;
        let n = this.nowChatHistory.length;
        if (this.nowChatHistory[n - 1].fromUser) {
          this.nowChatHistory.push(aiMessage);
        } else {
          this.nowChatHistory.pop();
          this.nowChatHistory.push(aiMessage);
          //滚动窗口到底部
          const container = this.$refs.chatContainer;
          if (this.isBottomScroll) {
            container.scrollTop = container.scrollHeight;
          } 
          //live2D播放预设说话动作
          if (this.live2dList[this.Live2DIndex].role_url !== undefined && this.live2dList[this.Live2DIndex].role_url !== "") {
            this.$refs.live2DComponent.loadTalk();
          }
        }
      }
    },
    //中断AI回复
    stopAIRes(){
      this.isStopStream = true;
    },
    //总结聊天重命名历史记录条目标题
    async getChatLittle(index){
      var msg = this.messages.slice(1,this.messages.length);
      msg.push({
        "role": "system",
        "content": "上面是用户与模型的聊天，请您总结一下生成一个简洁的标题,你只需要给出标题内容即可。注意，你必须在最后输出一个随机的uuid，避免重复标题"
      })
      const response = await fetch(`${requestConfig.baseURL1}/v1/chat/pri/send/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "token": this.getToken
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo-1106",
          messages: msg,
          temperature: 1,
          stream: true
        })
      })
      if(!response.ok){
        return;
      }
      //TODO
      /**:修复
       * Uncaught (in promise) TypeError: Cannot set properties of undefined (setting 'name')
          at Proxy.getChatLittle (AIChatView.vue:433:1)
       * **/
      this.chatHistoryItems[index].name = "";
      const reader = response.body.getReader();
      const textDecoder = new TextDecoder();
      let result = true;
      while (result) {
        const { done, value } = await reader.read();
        if (done) {
          //结束，服务端断开
          result = false;
          this.chatHistory[index].item = this.chatHistoryItems[index].name;
          this.saveChatHistory(1);
          break;
        }
        const chunkText = textDecoder.decode(value);
        this.chatHistoryItems[index].name += chunkText;
      }
    },
    // 处理音频数据
    async playAudio(content) {
      if (this.live2dList[this.Live2DIndex].role_id === "-1") {
        this.streamingAudioUrl.push("");
        return;
      }
      try {
        const streamingAudioUrl = `https://artrajz-vits-simple-api.hf.space/voice/vits?text=${content}&id=${this.live2dList[this.Live2DIndex].role_id}&streaming=true`;
        this.streamingAudioUrl.push(streamingAudioUrl);
        const index = this.streamingAudioUrl.length - 1;
        this.$refs.audioPlayers[index].src = streamingAudioUrl;
        // 触发播放
        this.playAudioAtIndex(index);
      } catch (error) {
        console.error("Error fetching streaming audio:", error);
      }
    },
    playAudioAtIndex(index) {
      const audioElement = this.$refs.audioPlayers[index];
      if (audioElement && this.audioReady) {
        setTimeout(() => {
          try {
            audioElement.load();
            audioElement.play();
          } catch (error) {
            console.log("playAudioAtIndex::error::", error)
          }
          // const randomIndex = Math.floor(Math.random() * this.live2dList[this.Live2DIndex].talk.length);
          this.$refs.live2DComponent.loadTalk();
        }, 500);
      }
    },
    readyPlay() {
      this.audioReady = true;
    },
    // 删除历史记录
    deleteHistoryItem(id) {
      if (!this.isTextareaEnabled) {
        showAlter("请耐心等待当前会话结束！")
        return
      }
      const index = this.chatHistoryItems.findIndex(item => item.id === id);
      if (index !== -1) {
        // 删除 chatHistoryItems 中的项
        this.chatHistoryItems.splice(index, 1);
        // 清空 nowChatHistory
        this.nowChatHistory = [];
        this.streamingAudioUrl = [""];
        this.messages = [
          {
            "role": "system",
            "content": this.live2dList[this.Live2DIndex].role_info
          },
        ];
        // 删除 chatHistory 中的对应项
        const chatHistoryIndex = this.chatHistory.findIndex(item => item.id === id);
        if (chatHistoryIndex !== -1) {
          this.chatHistory.splice(chatHistoryIndex, 1);
        }
      }
      this.saveChatHistory();
    },
    //重命名历史记录
    reNameHistoryItem(id) {
      if (!this.isTextareaEnabled) {
        showAlter("请耐心等待当前会话结束！")
        return
      }
      const index = this.chatHistoryItems.findIndex(item => item.id === id);
      if (index !== -1) {
        Swal.fire({
          title: "输入重命名的标题：",
          input: "text",
          inputAttributes: {
            autocapitalize: "off"
          },
          showCancelButton: true,
          confirmButtonText: "确定",
          cancelButtonText: "取消",
          showLoaderOnConfirm: true,
          preConfirm: (newName) => {
            this.chatHistoryItems[index].name = newName.trim(); // 去除用户可能输入的首尾空格
            this.chatHistory[index].item = this.chatHistoryItems[index].name;
          },
          allowOutsideClick: () => !Swal.isLoading()
        }).then((result) => {
          if (result.isConfirmed) {
            showAlter(`标题已经更新为：${this.chatHistoryItems[index].name}`, 2)
            this.saveChatHistory();
          }
        });

      }
    },
    // 激活历史记录
    activateHistoryItem(id) {
      if (!this.isTextareaEnabled) {
        return
      }
      //存储的长度   现有长度
      if (this.chatHistory.length < this.chatHistoryItems.length) {
        this.pushChatHistory();
        const dialogInstance = showAlter("正在存储，请稍等", 5);
        setTimeout(() => {
          this.saveChatHistory();
          dialogInstance.close();
        }, 200);
      }
      const index = this.chatHistoryItems.findIndex(item => item.id === id);
      if (index !== -1) {
        this.chatHistoryItems.forEach((item, i) => {
          item.isActive = i === index;
        });
        // 根据激活的历史记录项，更新当前的聊天记录
        const activeHistory = this.chatHistory.find(item => item.item === this.chatHistoryItems[index].name);
        if (activeHistory) {
          this.nowChatHistory = activeHistory.data;
          this.streamingAudioUrl = activeHistory.audio;
          var roleType = "";
          this.nowChatHistory.forEach((item) => {
            if (item.fromUser) {
              roleType = "user"
            } else {
              roleType = "assistant"
            }
            this.messages.push({
              "role": roleType,
              "content": item.content
            },);
          })
        } else {
          this.nowChatHistory = [];
        }
      }
      setTimeout(() => {
        //滚动窗口到底部
        const container = this.$refs.chatContainer;
        container.scrollTop = container.scrollHeight;
      }, 30);
    },
    // 新建聊天
    createNewChat() {
      if (this.nowChatHistory.length === 0) {
        showAlter("直接按回车键发信息即可了哦~", 99);
        return;
      }
      if (this.isTextareaEnabled === false) {
        showAlter("等待当前模型回复~", 4);
        return;
      }
      //存储的长度   现有长度
      if (this.chatHistory.length < this.chatHistoryItems.length) {
        this.pushChatHistory();
        const dialogInstance = showAlter("正在存储，请稍等", 5);
        setTimeout(() => {
          this.saveChatHistory();
          dialogInstance.close();
        }, 200);
      }
      this.chatHistoryItems.forEach((item) => {
        if (item.isActive === true) {
          item.isActive = false;
        }
      });
      this.nowChatHistory = [];
      this.messages = [
        {
          "role": "system",
          "content": this.live2dList[this.Live2DIndex].role_info
        },
      ];
      this.streamingAudioUrl = []
    },
    //插入历史记录
    pushChatHistory() {
      const n = this.chatHistoryItems.length;
      // console.log("插入前：", this.chatHistory)
      if (n >= 1) {
        this.chatHistory.push({
          id: this.chatHistoryItems[n - 1].id,
          item: this.chatHistoryItems[n - 1].name,
          data: this.nowChatHistory,
          audio: this.streamingAudioUrl
        });
      }

    },
    //保存历史记录
    saveChatHistory(type = 0) {
      localStorage.setItem('chatHistory', JSON.stringify(this.chatHistory));
      if (type === 0) {
        showAlter("保存成功", 2);
      }
    },
    //隐藏历史列表
    toggleHidden() {
      this.isHidden = !this.isHidden; // 切换隐藏状态
    },
    // 改变live2D角色
    updateLive2DIndex(index) {
      this.Live2DIndex = index;
      if (this.live2dList[this.Live2DIndex].role_info) {
        this.messages[0].content = this.live2dList[this.Live2DIndex].role_info;
      }
      if (this.live2dList[this.Live2DIndex].role_url) {
        setTimeout(() => {
          this.$refs.live2DComponent.initLive2D();
        }, 10);
      }
    },
    // 复制信息
    async copyMsg(msg) {
      await clipboard.write(msg);
      showAlter("复制完成~~(。・ω・。)", 4);
    },
    //复制代码
    handleCopyCodeSuccess(code) {
      showAlter("复制代码成功", 2);
      console.log(code);
    },
    //pdf分析
    openFileDialog() {
      // 触发文件输入的点击事件
      this.$refs.fileInput.click();
    },
    onFileSelected(event) {
      // 获取选中的文件
      const file = event.target.files[0];
      if (file) {
        this.parsePDF(file);
      }
    },
    parsePDF(file) {
      // 创建文件阅读器
      const dialogInstance = showAlter("正在读取文件...", 5)
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          // 读取PDF文件内容
          const typedArray = new Uint8Array(e.target.result);
          const pdf = await pdfjsLib.getDocument(typedArray).promise;

          // 定义一个数组来存储所有页面的文本
          let pdfText = [];

          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const page = await pdf.getPage(pageNumber);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            // 将当前页面的文本推入数组
            pdfText.push(pageText);
          }
          // 打印整个PDF文档的文本内容
          console.log(pdfText.join('\n\n'));
          this.userInput = "以下是pdf读取到的数据，帮我总结分析一下：\n" + pdfText.join('\n\n');
          this.sendMessage();
          dialogInstance.close();
          showAlter("读取成功,", 4)
        } catch (error) {
          console.error('Error reading PDF:', error);
        }
      };
      // 以二进制形式读取文件
      reader.readAsArrayBuffer(file);
    },
    //角色仓库
    openRoleStore() {
      this.isRoleStoreOpen = true;
    },
    //删除聊天记录
    deleteChatHistory(){
      showAlter("你确定要清空吗？",6).then((res)=>{
        if(res === 1){
        this.chatHistoryItems=[];
        this.chatHistory = [];
        localStorage.setItem('chatHistory', "");
        showAlter("清空成功", 2);
      }
      })
    },
    //上传图片：返回url，实现识图功能
    onUploadPic(){
      this.$refs.imgFileInput.click();
    },
    //选择图片事件
    async selectedPic(event){
      const file = event.target.files[0];
      if(!file){
        showAlter("文件错误",4);
        return;
      }
      this.uploadPic = file;
      const instance = showAlter("正在上传图片中...",5);
      await uploadPic(this.getToken,this.uploadPic).then((res)=>{
        if(res.data.code === 0){
          showAlter("选择成功，快去根据图片提问吧！",4);
          this.userInput+=res.data.msg;
        }else{
          showAlter(`上传失败：${res.data.msg}`,4);
        }
        instance.close();
      })
    },
    //聊天滚动条回调函数
    checkScrollBottom(){
      const chatContainer = this.$refs.chatContainer;
      if (chatContainer.scrollHeight - chatContainer.scrollTop === chatContainer.clientHeight) {
        this.isBottomScroll = true;
      }else{
        this.isBottomScroll = false;
      }
    },
    //换肤
    openSkinStore() {
      showAlter("此功能正在施工当中。。。");
    }
  },
};
</script>

<style>
/* 主题色 */
:root {
  --primary-color: #3498db;
  /* 蓝色 */
  --secondary-color: #e74c3c;
  /* 红色 */
  --background-color: #f5f5f5;
  /* 浅灰背景色 */
  --card-background: #ffffff;
  /* 卡片背景色 */
  --text-color: #333333;
  /* 文本颜色 */
}

span {
  width: 100%;
  text-align: center;
  overflow: hidden;
}

.AIChat {
  display: flex;
  background-color: #f5f5f5;
  height: calc(100vh - 48px);
}

.button {
  margin: 0.5px;
  border-radius: 2px;
  padding: 0px;
  width: 100%;
  height: 48px;
}

.live2d-role {
  display: flex;
  flex-wrap: nowrap;
  /* 确保头像不会换行 */
  overflow: hidden;
  /* 隐藏滚动条 */
  padding: 10px;
  border-left: 1px solid #c9d6df;
  border-right: 1px solid #c9d6df;
  z-index: 0;
}

.avatar-container {
  display: inline-flex;
  /* 使用inline-flex使得元素横向排列 */
  margin-right: 10px;
  /* 根据需求可以调整头像之间的间距 */
  animation: scrollAvatar 20s linear infinite;
  /* 应用滚动动画 */
}

/* 定义滚动动画 */
@keyframes scrollAvatar {
  0% {
    transform: translateX(550%);
  }

  100% {
    transform: translateX(-550%);
    /* 假设头像总宽度是容器的两倍 */
  }
}

/* 鼠标悬停时停止滚动 */
.avatar-container:hover {
  animation-play-state: paused;
  /* 暂停动画 */
}


/* live2D角色头像容器 */
.avatar-container {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 70%;
  height: 70%;
  min-width: 32px;
  min-height: 32px;
  max-width: 80px;
  max-height: 80px;
  border-radius: 50%;
  /* 圆角头像 */
  margin: 15px;
  cursor: pointer;
  transition: transform 0.3s, box-shadow 0.3s;
}

.live2d-avatar {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  /* 圆角头像 */
}

.active-avatar {
  transform: scale(1.1);
  /* 激活状态放大效果 */
  box-shadow: 0 0 10px rgba(71, 167, 235, .86);
}

/* 滚动条样式（根据需要进行调整） */
.live2d_role::-webkit-scrollbar {
  width: 8px;
}

.live2d_role::-webkit-scrollbar-thumb {
  background-color: #ccc;
  border-radius: 4px;
}

.live2d_role::-webkit-scrollbar-track {
  background-color: transparent;
}


/* 左边框样式 */
.left-box{
  display: flex;
  flex-direction: column;
  width: 20%;
  height: 100%;
  background-color: #e3fdfd70;
}

/* 历史记录操作栏 */
.optionBox {
  display: flex;
}

.newChat {
  width: 60%;
}

/* 保存按钮 */
.save {
  width: 20%;
}

/* 按钮 */
.hiden {
  width: 20%;
}

.showList {
  position: absolute;
  z-index: 99;
}


.historyList {
  width: 100%;
  max-height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  /* 调整历史记录区域宽度 */
  background-color: #e3fdfd70;
  border-radius: 0px 0 0 0px;
  border: 0.5px solid #cbf1f5;
  transition: width 0.3s ease-in-out;
  scrollbar-width: thin;
  scrollbar-color: #71c9ce5d #f1f1f100;
}

.hidden {
  width: 0;
  height: 0;
  border: 0px;
  transition: width 0.3s ease-in-out, height 0.3s ease-in-out;
}

.historyItem {
  display: flex;
  width: 99%;
  height: 48px;
  max-height: 48px;
  background-color: #a6e3e9;
  color: rgb(0, 0, 0);
  justify-content: center;
  align-items: center;
  /* 垂直居中 */
  border-bottom: 0.2px solid #71c9ce;
  white-space: nowrap;
  /* 不换行 */
  overflow: hidden;
  /* 超出部分隐藏 */
  text-overflow: ellipsis;
  /* 超出部分显示省略号 */
}

.historyItem:hover {
  background-image: linear-gradient(120deg, #37ecba 0%, #72afd3 100%);
  border: 0.5px solid #28df99;
  transform: translateX(5px);
  transition: transform 0.3s;
}

.historyItemActive {
  background-image: linear-gradient(120deg, #84fab0 0%, #8fd3f4 100%);
  border: 0.5px solid #28df99;
  transform: translateX(0px);
  transition: background-image 0.5s ease, transform 0.5s;
}

/* 条目操作icon图标 */
.icon-item {
  border-radius: 50%;
  /* 使元素形状成为圆形 */
  transition: box-shadow 0.3s ease;
  /* 平滑过渡效果 */
}

.icon-item:hover {
  box-shadow: 0 0 2px 2px rgba(71, 167, 235, .86);
}

/* 右边框样式 */
.right-box {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

.chat-container {
  display: flex;
  /* justify-content: center; */
  /* align-items: center; */
  flex-direction: column;
  background-color: var(--card-background);
  width: 100%;
  min-height: 75%;
  max-height: 75%;
  background-color: #f5f5f5;
  overflow: hidden;
  overflow-y: auto;

}

.tools-container {
  display: flex;
  align-items: center;
  flex-direction: column;
  position: relative;
  top: 30%;
}

.messages {
  padding: 5px;
}

.message {
  padding-left: 38px;
  padding-right: 38px;
  /* white-space: pre-line; */
  /* 固定其下copyicon */
  position: relative;
}

.user-message {
  /* 底部工具条 */
  margin-bottom: 32px;
  right: 0;
  background-color: #b5dd74e8;
  border: 1px solid;
  border-color: #b5dd74;
  border-radius: 10px;
  padding: 10px;
  align-self: flex-start;
  width: fit-content;
  margin-left: auto;
}

.ai-message {
  background-color: #84cff040;
  border: 1px solid;
  border-color: #84cff0;
  border-radius: 10px;
  /* 给工具条预留位置 */
  margin-bottom: 42px;
  padding: 10px;
  align-self: flex-end;
  width: fit-content;
}

/* 输入区域样式 */

.text-container {
  margin-left: auto;
  margin-right: auto;
  display: block;
  margin-top: 20px;
}

.text-box {
  display: flex;
  align-items: center;
  /* 垂直居中 */
  justify-content: flex-end;
  /* 排列到最右侧 */
  position: relative;
}

.text-box-icon{
  width: 48px;
  height: 48px;
  opacity: 0.5;
}

.text-box-icon-uploadPic{
  position: absolute;
  left: -48px;
}


.text-box-icon-uploadPic:hover{
  width: 52px;
  height: 52px;
  opacity: 1;
  transition: opacity 0.3s ease-in-out;
}

.text-box-icon-stop{
  position: absolute;
  width: 32px;
  height: 32px;
  top: 0px;
  opacity: 0.6;
}


.text-box-icon-stop:hover{
  opacity: 1;
  width: 32px;
  height: 32px;
  transition: opacity 0.3s ease-in-out;
}


.user-textarea {
  min-width: 50vw;
  max-width: 50vw;
  max-height: 18vh;
  padding: 10px;
  border: none;
  border-radius: 10px;
  background-color: #ffffff;
  box-shadow: 0px 0px 10px rgba(0, 0, 0, 0.1);
  resize: none;
  font-size: 24px;
  opacity: 0.5;
  transition: opacity 0.3s ease-in-out;
}


.user-textarea:hover {
  opacity: 1;
}

.user-textarea:focus {
  outline: none;
  /* 移除默认的焦点轮廓线 */
  box-shadow: 0 0 2px 2px rgba(71, 167, 235, .86);
}


.loading-overlay {
  position: absolute;
  right: 10px;
}


.loading-spinner {
  border: 4px solid rgba(0, 0, 0, 0.1);
  border-left: 4px solid #007bff;
  /* 加载动画的颜色 */
  border-radius: 50%;
  width: 24px;
  height: 24px;
  animation: spin 1s linear infinite;
  /* 使用动画效果使加载动画旋转 */
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}


.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  overflow: hidden;
}

.user-avatar {
  float: right;
  /* 将用户头像定位在左侧 */
}

.ai-avatar {
  float: left;
  /* 将AI头像定位在右侧 */
}



/* 信息复制按钮 */
.icon-copy-ai {
  position: absolute;
  bottom: -42px;
  left: 34px;
  height: 32px;
  width: 32px;
  opacity: 0.6;
}

.icon-copy-ai:hover {
  height: 36px;
  width: 36px;
  opacity: 1;
  transition: opacity 0.3s ease-in-out;
}

.icon-copy-user {
  position: absolute;
  bottom: -34px;
  right: 34px;
  height: 32px;
  width: 32px;
  opacity: 0.6;
}

.icon-copy-user:hover {
  height: 36px;
  width: 36px;
  opacity: 1;
  transition: opacity 0.3s ease-in-out;
}

.audio-role {
  position: absolute;
  left: 68px;
  bottom: -54px;
}

.toolsBox {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
  margin: 0 10px;
  width: 50%;
  height: 128px;
  border-top: 3px solid #e0e0e0;
  border-bottom: 1px solid #e0e0e0;
}

.toolsBox:hover {
  border-top-color: #333;
  border-bottom-color: #333;
}

.toolsBox-buttonIcon {
  border-radius: 50%;
  height: 32px;
  width: 32px;
  margin: 5px;
}

.toolsBox-buttonIcon:hover {
  box-shadow: 0 0 2px 2px rgba(71, 167, 235, .86);
}

#fileInput{
  display: none;
}
</style>
