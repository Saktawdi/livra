import axios from "../utils/request";
import { requestConfig } from "../utils/request";

// 上传图片接口
export const uploadPic = (token,file) => {
    // 构造上传请求
    const formData = new FormData();
    formData.append("file", file);
    return  axios.post( `${requestConfig.baseURL1}/v1/image/pri/upload`, formData, {
        headers: {
            "Content-Type": "multipart/form-data" ,
            "token": token
        }
    });
}
