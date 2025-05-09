export default {
  async fetch(request) {
    // --- 配置：Source 到 Target URL Base 模板的映射 ---
    // !! 重要 !!: 请确保这里的URL模板包含 ${date} 占位符
    const sourceToTargetMap = {
      'datiya': 'https://free.datiya.com/uploads/${date}-clash.yaml',
      'gamma': 'https://feeds.gamma-service.net/data?for_date=${date}&format=json',
    };

    // --- 解析入站请求的查询参数 ---
    const incomingUrl = new URL(request.url);
    var sourceParam = incomingUrl.searchParams.get('source');

    if (!sourceParam || !sourceToTargetMap[sourceParam.toLowerCase()]) {
      let errorMessage = '错误：必须提供有效的 "source" 查询参数。';
      if (sourceParam) {
        errorMessage = `错误："source" 参数 "${sourceParam}" 无效。可用的sources有：${Object.keys(sourceToTargetMap).join(', ')}。`;
      } else {
        errorMessage = `错误："source" 查询参数缺失。可用的sources有：${Object.keys(sourceToTargetMap).join(', ')}。`;
      }
      //return new Response(errorMessage, {
      //  status: 400,
      //  headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      //});
      sourceParam = 'datiya';
    }

    const targetUrlTemplate = sourceToTargetMap[sourceParam.toLowerCase()];
    console.log(`选定的 Target URL 模板 (基于 source="${sourceParam}"): ${targetUrlTemplate}`);

    // --- 辅助函数：获取指定日期的YYYYMMDD格式（新加坡时间） ---
    function getSingaporeDateString(dateObj) {
      // 当前时间是 2025年5月9日。此函数会返回类似 "20250509"
      const year = dateObj.toLocaleString('en-US', { timeZone: 'Asia/Singapore', year: 'numeric' });
      const month = dateObj.toLocaleString('en-US', { timeZone: 'Asia/Singapore', month: '2-digit' });
      const day = dateObj.toLocaleString('en-US', { timeZone: 'Asia/Singapore', day: '2-digit' });
      return `${year}${month}${day}`;
    }

    // --- 辅助函数：构建URL，通过替换模板中的 ${date} ---
    function buildUrlWithDate(baseUrlTemplate, dateStr) {
      // 例如: baseUrlTemplate = "https://example.com/api/${date}/data", dateStr = "20250509"
      // 返回: "https://example.com/api/20250509/data"
      return baseUrlTemplate.replace(/\${date}/g, dateStr); // 使用全局替换以防模板中意外有多个
    }

    // --- 辅助函数：执行fetch并最终确定响应 ---
    async function fetchAndFinalize(urlToFetch, isRetry = false) {
      const attemptType = isRetry ? "第二次尝试 (前一天)" : "第一次尝试 (当天)";
      console.log(`${attemptType} - Fetching from URL: ${urlToFetch}`);

      try {
        const fetchResponse = await fetch(urlToFetch);

        if (!fetchResponse.ok) {
          if (fetchResponse.status === 404 && !isRetry) {
            console.log(`${attemptType} - URL ${urlToFetch} 返回 404。将尝试前一天。`);
            return fetchResponse; // 返回原始的404响应对象给外部逻辑判断是否重试
          }
          const errorText = `${attemptType} - URL ${urlToFetch} 返回状态码: ${fetchResponse.status}`;
          console.warn(errorText);
          const responseBody = await fetchResponse.text().catch(() => errorText);
          const originalContentType = fetchResponse.headers.get('Content-Type') || 'text/plain; charset=utf-8';
          const responseHeaders = new Headers({ 'Content-Type': originalContentType });

          return new Response(responseBody || errorText, {
            status: fetchResponse.status,
            headers: responseHeaders,
          });
        }

        const textContent = await fetchResponse.text();
        const originalContentType = fetchResponse.headers.get('Content-Type');
        const responseHeaders = new Headers();
        if (originalContentType) {
          responseHeaders.set('Content-Type', originalContentType);
        } else {
          responseHeaders.set('Content-Type', 'text/plain; charset=utf-8');
        }
        console.log(`${attemptType} - URL ${urlToFetch} 成功获取内容。`);
        return new Response(textContent, {
          status: fetchResponse.status,
          headers: responseHeaders,
        });

      } catch (error) {
        const errorMessage = `${attemptType} - 获取内容时发生错误 (${urlToFetch}): ${error.message}`;
        console.error(errorMessage);
        return new Response(errorMessage, {
          status: 500,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    }

    // 1. 获取当前新加坡日期 (今天是 2025年5月9日)
    const today = new Date(); // 例如: 2025-05-09TXX:XX:XXZ
    const currentDateStr = getSingaporeDateString(today); // 例如: "20250509"
    let targetUrl = buildUrlWithDate(targetUrlTemplate, currentDateStr);

    // 2. 第一次尝试获取数据
    let finalResponse = await fetchAndFinalize(targetUrl, false);

    // 3. 如果第一次尝试返回404，则尝试前一天的日期
    if (finalResponse && finalResponse.status === 404) {
      // 计算前一天的日期 (新加坡时间)
      const sgYearToday = parseInt(today.toLocaleString('en-US', { timeZone: 'Asia/Singapore', year: 'numeric' }));
      const sgMonthToday = parseInt(today.toLocaleString('en-US', { timeZone: 'Asia/Singapore', month: 'numeric' })) - 1;
      const sgDayToday = parseInt(today.toLocaleString('en-US', { timeZone: 'Asia/Singapore', day: 'numeric' }));

      const todayInSGTReference = new Date(Date.UTC(sgYearToday, sgMonthToday, sgDayToday, 0, 0, 0));
      const yesterdayInSGT = new Date(todayInSGTReference.getTime() - (24 * 60 * 60 * 1000)); // 20250508
      
      const previousDateStr = getSingaporeDateString(yesterdayInSGT); // "20250508"
      const retryTargetUrl = buildUrlWithDate(targetUrlTemplate, previousDateStr);
      
      finalResponse = await fetchAndFinalize(retryTargetUrl, true);
    }
    
    return finalResponse;
  },
};
