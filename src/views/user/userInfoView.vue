<template>
  <div class="userContent">
    <div class="user-profile">
      <div class="profile-box animated-profile">
        <img :src="getUserData.avatar" alt="Avatar" class="userInfoAvatar">
        <h2 class="username">{{ getUserData.userName }}</h2>
        <p class="dept">{{ getUserData.dept.deptName }}</p>
      </div>
    </div>
    <div class="userOption-box">
      <div class="userOption-menu">
        <ul>
          <li @click="showSection('basic')">基本信息</li>
          <li @click="showSection('notice')">公告通知</li>
          <li @click="showSection('feedback')">在线反馈</li>
        </ul>
      </div>
      <div class="userOption-content">
        <div v-if="currentSection === 'basic'" class="userOption-section">
          <!-- 基本信息内容 -->
          <div class="userOption-section-basic">
            <div class="info-item">
              <label>用户ID:</label>
              <span>{{ getUserData.userId }}</span>
            </div>
            <div class="info-item">
              <label>创建时间:</label>
              <span>{{ getUserData.createTime }}</span>
            </div>
            <div class="info-item">
              <label>Email:</label>
              <span>{{ getUserData.email }}</span>
            </div>
            <div class="info-item">
              <label>电话号码:</label>
              <span>{{ getUserData.phoneNumber }}</span>
            </div>
          </div>

        </div>
        <div v-if="currentSection === 'notice'" class="userOption-section">
          <!-- 公告通知内容 -->
          <div class="notice-container">
            <!-- <h2 class="notice-heading">公告通知</h2> -->
            <h2 v-if="notice.length === 0">没有公告通知~</h2>
            <div v-for="item in notice" :key="item.noticeId" class="notice-item">
              <div :class="['notice-type', getNoticeTypeClass(item.noticeType)]">{{ getNoticeTypeLabel(item.noticeType) }}
              </div>
              <h3 class="notice-title">{{ item.noticeTitle }}</h3>
              <p class="notice-content">
                <v-md-preview :text="item.noticeContent"></v-md-preview>
              </p>
              <p class="notice-time">{{ formatTime(item.createTime) }}</p>
            </div>
          </div>
        </div>
        <div v-if="currentSection === 'feedback'" class="userOption-section">
          <!-- 在线反馈内容 -->
          <div class="feedback-container">
            <div class="feedback-option">
              <h2 class="feedback-heading">历史反馈</h2>
              <button class="feedback-postBtn" @click="postFeedback()">提交反馈</button>
            </div>
            <div v-if="feedbackData.length === 0">
              <h2>啊哦，还没有任何反馈内容呢</h2>
              <h3>您可以在这里反馈->bug/建议哦</h3>
            </div>
            <div v-for="item in feedbackData" :key="item.feedbackId" class="feedback-item"
              @click="activateFeedBackItem(item)">
              <div :class="['feedback-status', getFeedbackStatusClass(item.status)]">{{
                getFeedbackStatusLabel(item.status)
              }}</div>
              <div :class="['feedback-type', getFeedbackTypeClass(item.type)]">{{ getFeedbackTypeLabel(item.type) }}</div>
              <p class="feedback-content">
                {{ item.content }}
                <!-- <v-md-preview :text="item.content"></v-md-preview> -->
              </p>
              <div v-if="item.filePath" class="feedback-file">
                <img :src="baseURL + item.filePath" alt="Feedback File">
              </div>
              <p class="feedback-time">提交时间：{{ item.createTime }}</p>
            </div>
          </div>
          <!-- Feedback detail modal -->
          <div v-if="showDetailModal" class="feedback-detail-modal">
            <div class="modal-content">
              <div :class="['feedback-status', getFeedbackStatusClass(selectedFeedback.status)]">{{
                getFeedbackStatusLabel(selectedFeedback.status)
              }}</div>
              <div :class="['feedback-type', getFeedbackTypeClass(selectedFeedback.type)]">{{
                getFeedbackTypeLabel(selectedFeedback.type) }}</div>
              <p class="feedback-content">{{ selectedFeedback.content }}</p>
              <div v-if="selectedFeedback.filePath" class="feedback-file">
                <img :src="baseURL + selectedFeedback.filePath" alt="Feedback File">
              </div>
              <h3 class="feedback-reply" v-if="selectedFeedback.reply">回复: {{ selectedFeedback.reply }}</h3>
              <p class="feedback-time">提交时间：{{ selectedFeedback.createTime }}</p>
              <!-- Add more details here -->
              <button @click="closeFeedbackDetail">关闭</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { getUserInfoApi } from "@/api/getUser";
import { showAlter } from '@/utils/showAlter';
import Swal from "sweetalert2";
import { getNoticeListApi } from "@/api/notice";
import { getFeedbackListApi, sendFeedbackApi } from "@/api/feedback";
import { requestConfig } from "@/utils/request";

export default {
  components: {
  },
  data() {
    return {
      baseURL: requestConfig.baseURL1,
      showProfile: true,
      currentSection: 'notice', // 默认显示
      feedbackData: [],
      showDetailModal: false,
      selectedFeedback: {},
      notice: [] //通知列表
    }
  },
  mounted() {
    if (this.getToken) {
      this.getUserInfo();
    } else {
      this.$router.push({ path: '/login' });
    }
    this.showSection("notice");
  },
  computed: {
    getToken() {
      return this.$store.state.token;
    },
    getUserData() {
      return this.$store.getters.getUserInfo;
    },
  },
  methods: {
    getNoticeTypeLabel(type) {
      if (type === 1) return "公告";
      if (type === 2) return "信息";
      if (type === 3) return "通知";
      return "未知";
    },
    getNoticeTypeClass(type) {
      switch (type) {
        case 1:
          return 'warning';
        case 2:
          return 'announcement';
        case 3:
          return 'info';
        default:
          return 'unknown';
      }
    },
    formatTime(time) {
      return time;
    },
    //获取用户信息
    async getUserInfo() {
      if (!this.getToken) return;
      try {
        const result = await getUserInfoApi(this.getToken)
        if (result.data.code === 0) {
          localStorage.setItem('userInfo', result.data.data)
          this.$store.dispatch("setUserInfo", result.data.data)
          //刷新页面
          // location.reload();
        } else if (result.data.code === 401) {
          showAlter("登录已过期，请重新登录！", 0);
          this.$store.dispatch("clearUserInfo");
          this.$store.dispatch("clearToken");
        }
      } catch (error) {
        console.log(error)
      }
    },
    //获取通知信息
    async getNoticeList() {
      if (!this.getToken) return;
      try {
        const result = await getNoticeListApi(this.getToken)
        if (result.data.code === 0) {
          this.notice = this.sortedNotice(result.data.data);
        } else {
          showAlter("获取通知失败!", 0);
          console.log(result.data.msg)
        }
      } catch (error) {
        console.log(error)
      }
    },
    //排序通知信息
    sortedNotice(data) {
      // 首先筛选出 noticeType 等于 1 的项，然后按 updateTime 进行降序排序
      const sortedByType =data.filter(item => item.noticeType === 1);
      sortedByType.sort((a, b) => new Date(b.updateTime) - new Date(a.updateTime));
      // 筛选出 noticeType 不等于 1 的项，并按 updateTime 进行降序排序
      const sortedByTime = data.filter(item => item.noticeType !== 1);
      sortedByTime.sort((a, b) => new Date(b.updateTime) - new Date(a.updateTime));
      // 将两个排序后的数组拼接在一起
      return sortedByType.concat(sortedByTime);
    },
    //获取反馈列表
    async getFeedBackList() {
      if (!this.getToken) return;
      try {
        const result = await getFeedbackListApi(this.getToken)
        if (result.data.code === 0) {
          this.feedbackData = result.data.data
        } else {
          showAlter("获取通知失败!", 0);
          console.log(result.data.msg)
        }
      } catch (error) {
        console.log(error)
      }
    },
    //提交反馈
    postFeedback() {
      Swal.fire({
        title: '提交反馈',
        html:
          '<div class="custom-swal-content">' +
          '<textarea id="swal-input1" class="swal2-textarea" placeholder="请输入反馈内容"></textarea>' +
          '<div class="radioBox">' +
          '<label class="radio-label">' +
          '<input type="radio" id="swal-input2-bug" class="swal2-radio" name="feedbackType" value="1">' +
          '<span class="radio-span bug-radio">Bug</span>' +
          '</label>' +
          '<label class="radio-label">' +
          '<input type="radio" id="swal-input2-suggestion" class="swal2-radio" name="feedbackType" value="2">' +
          '<span class="radio-span suggestion-radio">建议</span>' +
          '</label>' +
          '</div>' +
          '<div class="file-input-wrapper">' +
          '<input type="file" id="swal-input3" class="swal2-input file-input" placeholder="选择文件">' +
          '</div>' +
          '</div>',
        focusConfirm: false,
        showCancelButton: true,
        cancelButtonText: '取消',
        confirmButtonText: '提交',
        customClass: {
          confirmButton: 'custom-swal-confirm-button',
          cancelButton: 'custom-swal-cancel-button',
          radio: 'custom-radio-style',
          'radio-span': 'radio-label-span',
          file: 'custom-file-input-style',
          'file-input-button': 'custom-file-button-style'
        },
        preConfirm: async () => {
          const selectedType = document.querySelector('input[name="feedbackType"]:checked');
          const typeValue = selectedType ? selectedType.value : ''; // 获取选中的单选框值
          const content = document.getElementById('swal-input1').value;
          const file = document.getElementById('swal-input3').files[0];
          if (!content || !typeValue) {
            Swal.showValidationMessage('请填写完整！附件可空');
            return
          }
          try {
            const response = await sendFeedbackApi(
              this.getToken,
              file,
              this.getUserData.userId,
              content,
              typeValue
            );
            if (response.data.code === 0) {
              return { success: true };
            } else {
              throw new Error(response.data.message);
            }
          } catch (error) {
            Swal.showValidationMessage(
              `提交失败: ${error.message}`
            );
            return { success: false };
          }
        }
      }).then((result) => {
        if (result.value && result.value.success) {
          Swal.fire({
            title: '提交成功',
            icon: 'success'
          });
        }
      });
    },
    //点击feedback条目，详细
    activateFeedBackItem(item) {
      this.selectedFeedback = item;
      this.showDetailModal = true;
    },
    //菜单选择
    showSection(section) {
      if (section === 'notice') {
        this.getNoticeList();
      } else if (section === 'feedback') {
        this.getFeedBackList();
      }
      this.currentSection = section;
    },
    closeFeedbackDetail() {
      this.showDetailModal = false;
    },
    getFeedbackStatusLabel(status) {
      switch (status) {
        case 0:
          return '已关闭';
        case 1:
          return '正在处理';
        case 2:
          return '处理完毕';
        case 3:
          return '已提交';
        default:
          return '未知状态';
      }
    },
    getFeedbackStatusClass(status) {
      switch (status) {
        case 0:
          return 'closed';
        case 1:
          return 'processing';
        case 2:
          return 'done';
        case 3:
          return 'submitted';
        default:
          return 'unknown';
      }
    },
    getFeedbackTypeLabel(type) {
      switch (type) {
        case 1:
          return 'Bug';
        case 2:
          return '建议';
        default:
          return '未知类型';
      }
    },
    getFeedbackTypeClass(type) {
      switch (type) {
        case 1:
          return 'bug';
        case 2:
          return 'suggestion';
        default:
          return 'unknown';
      }
    }
  },
}
</script>

<style>
.userContent {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-image: linear-gradient(-20deg, #2b5876 0%, #4e4376 100%);
}

.user-profile {
  text-align: center;
}

.animated-profile {
  margin-top: 10px;
  animation: profileAnimation 1s ease-in-out;
}

@keyframes profileAnimation {
  0% {
    opacity: 0;
    transform: scale(1.5) translateY(150%);
  }

  50% {
    opacity: 1;
    transform: scale(1) translateY(150%);
  }

  100% {
    opacity: 1 translateY(0);
  }
}

.userInfoAvatar {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  box-shadow: 0px 4px 6px rgba(0, 0, 0, 0.1);
}

.username {
  font-size: 32px;
  font-weight: bold;
  margin-bottom: 10px;
  color: #ffffff;
}

.dept {
  color: rgb(221, 221, 221);
}

.userOption-box {
  width: 80%;
  height: 80%;
  min-height: 65vh;
  background-color: rgb(255, 255, 255);
  box-shadow: 0 3px 8px 0 rgba(0, 0, 0, .03);
  border-radius: 12px;
  animation: optionBoxAnimation 1.2s ease-in-out;
}

@keyframes optionBoxAnimation {
  0% {
    opacity: 0;
    transform: scale(0);
  }

  100% {
    opacity: 1;
    transform: scale(1);
  }
}


/* 菜单栏样式 */
.userOption-menu {
  width: 10%;
  color: rgb(0, 0, 0);
  padding: 20px;
  box-sizing: border-box;
  float: left;
}

.userOption-menu ul {
  list-style: none;
  padding: 0;
}

.userOption-menu li {

  font-size: 18px;
  cursor: pointer;
  margin-bottom: 15px;
  transition: color 0.3s;
}

.userOption-menu li:hover {
  color: #ff9900;
  border-bottom: 1px solid;
}

.userOption-content {
  width: 90%;
  height: 100%;
  box-sizing: border-box;
  float: left;
}

.userOption-section {
  width: 100%;
  height: 100%;
  background-color: #ffffff;
  border-radius: 5px;
  box-shadow: 0px 4px 6px rgba(0, 0, 0, 0.1);
  animation: fadeIn 1s;
}

/* 动画效果 */
@keyframes fadeIn {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

@keyframes slideInLeft {
  from {
    transform: translateX(-20px);
  }

  to {
    transform: translateX(0);
  }
}

@keyframes slideInUp {
  from {
    transform: translateY(20px);
  }

  to {
    transform: translateY(0);
  }
}


/* 基础信息 */
.userOption-section-basic {
  padding: 20px;
  height: calc(65vh - 20px);
  background-color: #fff;
  border-radius: 5px;
  box-shadow: 0px 4px 6px rgba(0, 0, 0, 0.1);
  animation: fadeInUp 0.5s ease-out;
}

@keyframes fadeInUp {
  from {
    transform: translateY(20px);
    opacity: 0;
  }

  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.info-item {
  margin-bottom: 20px;
}

.info-item label {
  font-weight: bold;
  margin-right: 10px;
}


/* 通知 */
.notice-container {
  background-color: #f8f8f8;
  max-height: 65vh;
  padding-left: 20px;
  padding-right: 20px;
  padding-top: 20px;
  height: calc(100% - 20px);
  border-radius: 10px;
  box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.1);
  overflow: auto;
}

.notice-item {
  background-color: #fff;
  border-radius: 10px;
  padding: 20px;
  margin-bottom: 20px;
  box-shadow: 0px 4px 6px rgba(0, 0, 0, 0.1);
  transition: transform 0.3s, box-shadow 0.3s;
}

.notice-item:hover {
  transform: translateY(-5px);
  box-shadow: 0px 8px 12px rgba(0, 0, 0, 0.2);
}

.notice-type {
  display: inline-block;
  background-color: #007bff;
  color: #fff;
  padding: 5px 10px;
  border-radius: 5px;
  font-size: 14px;
}

.warning {
  background-color: #ff9800;
  color: #fff;
}

.announcement {
  background-color: #2196f3;
  color: #fff;
}

.info {
  background-color: #4caf50;
  color: #fff;
}

.unknown {
  background-color: #999;
  color: #fff;
}



.notice-title {
  font-size: 20px;
  margin-top: 10px;
}

.notice-content {
  color: #555;
  margin-top: 10px;
}

.notice-time {
  color: #999;
  margin-top: 10px;
  font-size: 12px;
}


/* 反馈 */
.feedback-container {
  padding: 10px;
  max-height: 65vh;
  overflow: auto;
}

.feedback-option {
  display: flex;
  justify-content: space-between;
}

.feedback-postBtn {
  margin-top: 8px;
  max-height: 38px;
  max-width: 128px;
}

.feedback-status {
  padding: 5px 10px;
  border-radius: 5px;
  font-size: 14px;
  display: inline-block;
  margin-bottom: 5px;
}

.closed {
  background-color: #5c5c5c;
  color: #fff;
}

.processing {
  background-color: #ffc107;
  color: #000;
}

.done {
  background-color: #4caf50;
  color: #fff;
}

.submitted {
  background-color: #2196f3;
  color: #fff;
}

.unknown {
  background-color: #999;
  color: #fff;
}

.feedback-type {
  margin-left: 2px;
  padding: 5px 10px;
  border-radius: 5px;
  font-size: 14px;
  display: inline-block;
  margin-bottom: 5px;
}

.bug {
  background-color: #f44336;
  color: #fff;
}

.suggestion {
  background-color: #03a9f4;
  color: #fff;
}

.feedback-item {
  background-color: #fff;
  border-radius: 10px;
  padding: 20px;
  margin-bottom: 20px;
  box-shadow: 0px 4px 6px rgba(0, 0, 0, 0.1);
  transition: transform 0.3s, box-shadow 0.3s;
}

.feedback-item:hover {
  transform: translateY(-5px);
  box-shadow: 0px 8px 12px rgba(0, 0, 0, 0.2);
}

.feedback-content {
  font-size: 16px;
  margin-bottom: 5px;
}

.feedback-reply {
  color: #4caf50;
  margin-bottom: 5px;
}

.feedback-file img {
  max-width: 100%;
  max-height: 200px;
}

.feedback-time {
  font-size: 12px;
  color: #777;
}

.feedback-detail-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
}

.modal-content {
  background-color: #fff;
  padding: 20px;
  border-radius: 5px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  max-width: 80%;
  text-align: center;
}

.modal-content h3 {
  font-size: 20px;
  margin-bottom: 10px;
}

.modal-content p {
  font-size: 16px;
  margin-bottom: 5px;
}

/* 提交反馈 */
/* 自定义单选框样式 */
.custom-radio-style {
  margin-right: 8px;
}

/* 自定义单选框标签样式 */
.radio-label {
  display: inline-block;
  margin-right: 16px;
  cursor: pointer;
}

/* 自定义单选框标签文字样式 */
.radio-label-span {
  font-size: 14px;
}

/* 自定义单选框 Bug 样式 */
.bug-radio {
  background-color: #f44336; /* 红色 */
  color: #fff;
  padding: 4px 8px;
  border-radius: 4px;
}

/* 自定义单选框建议样式 */
.suggestion-radio {
  background-color: #4caf50; /* 绿色 */
  color: #fff;
  padding: 4px 8px;
  border-radius: 4px;
}

/* 自定义文件输入框样式 */
.custom-file-input-style {
  display: flex;
  align-items: center;
  border: 1px solid #ccc;
  border-radius: 8px;
  padding: 8px;
  background-color: #fff;
  color: #333;
  font-size: 14px;
}

/* 自定义文件选择按钮样式 */
.custom-file-button-style {
  background-color: #007bff; /* 蓝色 */
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
}

</style>