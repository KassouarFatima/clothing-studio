import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSnapshot } from 'valtio'
import {
    headContainerAnimation,
    headContentAnimation,
    headTextAnimation,
    slideAnimation
} from '../config/motion';
import CustomButtom from '../comp/CustomButtom'
import GarmentSelector from '../comp/GarmentSelector'
import state from "../store/index"

const Home = () => {
    const snap = useSnapshot(state);
    return (
        <AnimatePresence>

            {snap.intro && (
                <motion.section className='home'{...slideAnimation('left')}>
                    <motion.header {...slideAnimation("down")}>
                        <img className='w-10 object-contain' src="./threejs.png" />
                    </motion.header>

                    <motion.div className='home-content' {...headContainerAnimation} >
                        <motion.div {...headTextAnimation}>
                            <h1 className='head-text text-white'>
                                Let's<br className='xl:block hidden' />Do it.
                            </h1></motion.div>
                        <motion.div {...headContentAnimation}
                            className="flex flex-col gap-5">
                            <p className='max-w-md font-normal text-grey-100 text-base'>
                                create your unique and exclusive shirt with our brand-nex 3D
                                customisation tool .<strong>Unleach your imagination </strong>
                                {" "}and define your own style.
                            </p>
                            <GarmentSelector />
                            <div className="flex gap-3 w-fit">
                            <CustomButtom
                                type="filled"
                                title="Customize it"
                                customStyles="w-fit px-4 font-bold text-sm py-2.5 whitespace-nowrap"
                                handleClick={() => state.intro = false} />
                            <CustomButtom type="filled" title="Wear it" customStyles="w-fit px-4 font-bold text-sm py-2.5 whitespace-nowrap" handleClick={() => state.wearItOpen = true} disabled={Boolean(snap.generatingGarment)} />
                            </div>
                        </motion.div>
                    </motion.div>

                </motion.section>
            )}
        </AnimatePresence>
    )
}

export default Home
