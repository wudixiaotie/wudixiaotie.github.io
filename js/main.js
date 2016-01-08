$(function() {
    traffic();
});

// 访问量统计
function traffic() {
    referer_url = document.referrer;
    referer_domain = referer_url.split('/')[2];
    $.ajax({
        url: "https://traffic-wudixiaotie.herokuapp.com/visitors",
        type: "post",
        data: {
            referer: referer_domain
        }
    });
}