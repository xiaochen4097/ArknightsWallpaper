(function (global) {
    "use strict";

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function toElement(target) {
        if (typeof target === "string") {
            return document.querySelector(target);
        }
        return target;
    }

    function createMousePerspective(target, options) {
        var element = toElement(target);
        if (!element) {
            return null;
        }

        var config = Object.assign({
            perspective: 1200,
            baseTransform: "",
            maxRotateX: 8,
            maxRotateY: 10,
            maxTranslateX: 28,
            maxTranslateY: 16,
            centerOffsetX: 0,
            centerOffsetY: 0,
            easing: 0.12,
            resetOnLeave: true,
            disableOnTouch: true
        }, options || {});

        var isTouchDevice = window.matchMedia("(pointer: coarse)").matches;
        if (config.disableOnTouch && isTouchDevice) {
            return {
                destroy: function () {},
                update: function () {}
            };
        }

        var current = { x: 0, y: 0 };
        var targetPos = { x: 0, y: 0 };
        var rafId = 0;

        function buildTransform(x, y) {
            var rotateX = -y * config.maxRotateX;
            var rotateY = x * config.maxRotateY;
            var translateX = x * config.maxTranslateX;
            var translateY = y * config.maxTranslateY;

            return "perspective(" + config.perspective + "px) " +
                "translate3d(" + translateX.toFixed(2) + "px, " + translateY.toFixed(2) + "px, 0) " +
                "rotateX(" + rotateX.toFixed(2) + "deg) " +
                "rotateY(" + rotateY.toFixed(2) + "deg) " +
                config.baseTransform;
        }

        function animate() {
            current.x += (targetPos.x - current.x) * config.easing;
            current.y += (targetPos.y - current.y) * config.easing;

            element.style.transform = buildTransform(current.x, current.y);

            if (Math.abs(targetPos.x - current.x) > 0.001 || Math.abs(targetPos.y - current.y) > 0.001) {
                rafId = requestAnimationFrame(animate);
            } else {
                rafId = 0;
            }
        }

        function requestTick() {
            if (!rafId) {
                rafId = requestAnimationFrame(animate);
            }
        }

        function onMove(event) {
            var x = ((event.clientX / window.innerWidth) - 0.5) * 2 + config.centerOffsetX;
            var y = ((event.clientY / window.innerHeight) - 0.5) * 2 + config.centerOffsetY;
            targetPos.x = clamp(x, -1, 1);
            targetPos.y = clamp(y, -1, 1);
            requestTick();
        }

        function onLeave() {
            if (!config.resetOnLeave) {
                return;
            }
            targetPos.x = 0;
            targetPos.y = 0;
            requestTick();
        }

        element.style.willChange = "transform";
        element.style.transformStyle = "preserve-3d";
        element.style.transform = buildTransform(0, 0);

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseleave", onLeave);

        return {
            destroy: function () {
                if (rafId) {
                    cancelAnimationFrame(rafId);
                }
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseleave", onLeave);
            },
            update: function (nextOptions) {
                config = Object.assign(config, nextOptions || {});
                requestTick();
            }
        };
    }

    global.MousePerspective = {
        create: createMousePerspective
    };
})(window);
