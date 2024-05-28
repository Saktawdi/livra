import axios from "axios";
import { showAlter } from "./showAlter";
import router from '@/router'
import store from "@/store";
//https://api.sakta.top
//localhost:7868
export const requestConfig = {
    baseURL1: "https://api.sakta.top",
    baseURL2: "",
    timeout: 60000
}

const service = axios.create({
    timeout: requestConfig.timeout
});

// 请求拦截器
service.interceptors.request.use(
    config => {
        // 在发送请求之前做些什么
        // 比如，可以在这里设置请求头（headers），如添加token等
        // config.headers['Authorization'] = 'Bearer your-token';
        // 还可以根据需要进行更多的配置或者修改
        return config;
    },
    error => {
        return Promise.reject(error);
    }
);

// 响应拦截器
service.interceptors.response.use(
    response => {
        return response;
    },
    error => {
        // 对响应错误做点什么
        // 如果是HTTP错误状态码，可以在这里统一处理
        // 例如：
        // if (error.response.status === 401) {
        //   // 处理401错误
        // }
        if (error.response.data.msg === 'token已过期') {
            store.dispatch('clearToken');
            store.dispatch('clearUserInfo');
            router.push('/login').then(() => location.reload());
            showAlter("登录已过期，请重新登录");
        }
        return Promise.reject(error);
    }
);

export default service;